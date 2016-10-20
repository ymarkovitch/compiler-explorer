#!/usr/bin/env node

// Copyright (c) 2012-2016, Matt Godbolt
// All rights reserved.
// 
// Redistribution and use in source and binary forms, with or without 
// modification, are permitted provided that the following conditions are met:
// 
//     * Redistributions of source code must retain the above copyright notice, 
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright 
//       notice, this list of conditions and the following disclaimer in the 
//       documentation and/or other materials provided with the distribution.
// 
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" 
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE 
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE 
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE 
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR 
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF 
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS 
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN 
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) 
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE 
// POSSIBILITY OF SUCH DAMAGE.

// load external and internal libraries (will load more internal binaries later)
var nopt = require('nopt'),
    os = require('os'),
    props = require('./lib/properties'),
    CompileHandler = require('./lib/compile').CompileHandler,
    buildDiffHandler = require('./lib/diff').buildDiffHandler,
    express = require('express'),
    child_process = require('child_process'),
    path = require('path'),
    fs = require('fs-extra'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    Promise = require('promise'),
    aws = require('./lib/aws'),
    _ = require('underscore-node');

// Parse arguments from command line 'node ./app.js args...'
var opts = nopt({
    'env': [String, Array],
    'rootDir': [String],
    'language': [String],
    'host': [String],
    'port': [Number],
    'propDebug': [Boolean],
    'static': [String]
});

// Set default values for omitted arguments
var rootDir = opts.rootDir || './etc';
var language = opts.language || "C++";
var env = opts.env || ['dev'];
var hostname = opts.host || os.hostname();
var port = opts.port || 10240;
var staticDir = opts.static || 'static';
var gitReleaseName = child_process.execSync('git rev-parse HEAD').toString().trim();

console.log(env);
console.log(typeof(env));
var propHierarchy = _.flatten([
    'defaults',
    env,
    language,
    _.map(env, function (e) {
        return e + '.' + process.platform;
    }),
    process.platform,
    os.hostname()]);
console.log("properties hierarchy: " + propHierarchy.join(', '));

// Propagate debug mode if need be
if (opts.propDebug) props.setDebug(true);

// *All* files in config dir are parsed 
props.initialize(rootDir + '/config', propHierarchy);

// Instantiate a function to access records concerning "gcc-explorer" 
// in hidden object props.properties
var gccProps = props.propsFor("gcc-explorer");

// Read from gccexplorer's config the wdiff configuration
// that will be used to configure lib/diff.js
var wdiffConfig = {
    wdiffExe: gccProps('wdiff', "wdiff"),
    maxOutput: gccProps("max-diff-output", 100000)
};

// Instantiate a function to access records concerning the chosen language
// in hidden object props.properties
var compilerPropsFunc = props.propsFor(language.toLowerCase());

// If no option for the compiler ... use gcc's options (??)
function compilerProps(property, defaultValue) {
    // My kingdom for ccs... [see Matt's github page]
    var forCompiler = compilerPropsFunc(property, undefined);
    if (forCompiler !== undefined) return forCompiler;
    return gccProps(property, defaultValue); // gccProps comes from lib/compile.js
}
require('./lib/compile').initialise(gccProps, compilerProps);
var staticMaxAgeSecs = gccProps('staticMaxAgeSecs', 0);

var awsProps = props.propsFor("aws");
var awsPoller = null;
function awsInstances() {
    if (!awsPoller) awsPoller = new aws.InstanceFetcher(awsProps);
    return awsPoller.getInstances();
}

// function to load internal binaries (i.e. lib/source/*.js)
function loadSources() {
    var sourcesDir = "lib/sources";
    var sources = fs.readdirSync(sourcesDir)
        .filter(function (file) {
            return file.match(/.*\.js$/);
        })
        .map(function (file) {
            return require("./" + path.join(sourcesDir, file));
        });
    return sources;
}

// load effectively
var fileSources = loadSources();
var sourceToHandler = {};
fileSources.forEach(function (source) {
    sourceToHandler[source.urlpart] = source;
});

// auxiliary function used in clientOptionsHandler
function compareOn(key) {
    return function (xObj, yObj) {
        var x = xObj[key];
        var y = yObj[key];
        if (x < y) return -1;
        if (x > y) return 1;
        return 0;
    };
}

// instantiate a function that generate javascript code,
function ClientOptionsHandler(fileSources) {
    var sources = fileSources.map(function (source) {
        return {name: source.name, urlpart: source.urlpart};
    });
    // sort source file alphabetically
    sources = sources.sort(compareOn("name"));
    var text = "";
    this.setCompilers = function (compilers) {
        var options = {
            googleAnalyticsAccount: gccProps('clientGoogleAnalyticsAccount', 'UA-55180-6'),
            googleAnalyticsEnabled: gccProps('clientGoogleAnalyticsEnabled', false),
            sharingEnabled: gccProps('clientSharingEnabled', true),
            githubEnabled: gccProps('clientGitHubRibbonEnabled', true),
            gapiKey: gccProps('googleApiKey', ''),
            googleShortLinkRewrite: gccProps('googleShortLinkRewrite', '').split('|'),
            defaultSource: gccProps('defaultSource', ''),
            language: language,
            compilers: compilers,
            sourceExtension: compilerProps('compileFilename').split('.', 2)[1],
            defaultCompiler: compilerProps('defaultCompiler', ''),
            compileOptions: compilerProps("options"),
            supportsBinary: !!compilerProps("supportsBinary"),
            postProcess: compilerProps("postProcess"),
            sources: sources,
            raven: gccProps('ravenUrl', ''),
            release: gitReleaseName,
            environment: env
        };
        text = JSON.stringify(options);
    };
    this.handler = function getClientOptions(req, res) {
        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'public, max-age=' + staticMaxAgeSecs);
        res.end(text);
    };
}

// function used to enable loading and saving source code from web interface
function getSource(req, res, next) {
    var bits = req.url.split("/");
    var handler = sourceToHandler[bits[1]];
    if (!handler) {
        next();
        return;
    }
    var action = bits[2];
    if (action == "list") action = handler.list;
    else if (action == "load") action = handler.load;
    else if (action == "save") action = handler.save;
    else action = null;
    if (action === null) {
        next();
        return;
    }
    action.apply(handler, bits.slice(3).concat(function (err, response) {
        res.set('Cache-Control', 'public, max-age=' + staticMaxAgeSecs);
        if (err) {
            res.end(JSON.stringify({err: err}));
        } else {
            res.end(JSON.stringify(response));
        }
    }));
}

function retryPromise(promiseFunc, name, maxFails, retryMs) {
    return new Promise(function (resolve, reject) {
        var fails = 0;

        function doit() {
            var promise = promiseFunc();
            promise.then(function (arg) {
                resolve(arg);
            }, function (e) {
                fails++;
                if (fails < maxFails) {
                    console.log("Failed " + name + " : " + e + ", retrying");
                    setTimeout(doit, retryMs);
                } else {
                    console.log("Too many retries for " + name + " : " + e);
                    reject(e);
                }
            });
        }

        doit();
    });
}

// Auxiliary function to findCompilers()
function configuredCompilers() {
    // read config (file already read) (':' are used to separate compilers names)
    var exes = compilerProps("compilers", "/usr/bin/g++").split(":");
    var ndk = compilerProps('androidNdk');
    if (ndk) {
        var toolchains = fs.readdirSync(ndk + "/toolchains");
        toolchains.forEach(function (v, i, a) {
            var path = ndk + "/toolchains/" + v + "/prebuilt/linux-x86_64/bin/";
            if (fs.existsSync(path)) {
                var cc = fs.readdirSync(path).filter(function (filename) {
                    return filename.indexOf("g++") != -1;
                });
                a[i] = path + cc[0];
            } else {
                a[i] = null;
            }
        });
        toolchains = toolchains.filter(function (x) {
            return x !== null;
        });
        exes.push.apply(exes, toolchains);
    }

    function fetchRemote(host, port, props) {
        console.log("Fetching compilers from remote source " + host + ":" + port);
        return retryPromise(function () {
                return new Promise(function (resolve, reject) {
                    var request = http.get({
                        hostname: host,
                        port: port,
                        path: "/api/compilers"
                    }, function (res) {
                        var str = '';
                        res.on('data', function (chunk) {
                            str += chunk;
                        });
                        res.on('end', function () {
                            var compilers = JSON.parse(str).map(function (compiler) {
                                compiler.exe = null;
                                compiler.remote = "http://" + host + ":" + port;
                                return compiler;
                            });
                            resolve(compilers);
                        });
                    }).on('error', function (e) {
                        reject(e);
                    }).on('timeout', function () {
                        reject("timeout");
                    });
                    request.setTimeout(awsProps('proxyTimeout', 1000));
                });
            },
            host + ":" + port,
            props('proxyRetries', 5),
            props('proxyRetryMs', 500))
            .catch(function () {
                console.log("Unable to contact " + host + ":" + port + "; skipping");
                return [];
            });
    }

    function fetchAws() {
        console.log("Fetching instances from AWS");
        return awsInstances().then(function (instances) {
            return Promise.all(instances.map(function (instance) {
                console.log("Checking instance " + instance.InstanceId);
                var address = instance.PrivateDnsName;
                if (awsProps("externalTestMode", false)) {
                    address = instance.PublicDnsName;
                }
                return fetchRemote(address, port, awsProps);
            }));
        });
    }

    return Promise.all(exes.map(function (name) {
        if (name.indexOf("@") !== -1) {
            var bits = name.split("@");
            var host = bits[0];
            var port = parseInt(bits[1]);
            return fetchRemote(host, port, gccProps);
        }
        if (name == "AWS") {
            return fetchAws();
        }
        var base = "compiler." + name;
        var exe = compilerProps(base + ".exe", "");
        if (!exe) {
            return Promise.resolve({id: name, exe: name, name: name});
        }
        function props(name, def) {
            return compilerProps(base + "." + name, compilerProps(name, def));
        }

        return Promise.resolve({
            id: name,
            exe: exe,
            name: props("name", name),
            alias: props("alias"),
            options: props("options"),
            versionFlag: props("versionFlag"),
            is6g: !!props("is6g", false),
            isCl: !!props("isCl", false),
            intelAsm: props("intelAsm", ""),
            asmFlag: props("asmFlag", "-S"),
            outputFlag: props("outputFlag", "-o"),
            needsMulti: !!props("needsMulti", true),
            supportsBinary: !!props("supportsBinary", true),
            postProcess: props("postProcess", "")
        });
    })).then(_.flatten);
}

// Auxiliary function to findCompilers()
function getCompilerInfo(compilerInfo) {
    if (compilerInfo.remote) {
        return Promise.resolve(compilerInfo);
    }
    return new Promise(function (resolve) {
        var compiler = compilerInfo.exe;
        var versionFlag = compilerInfo.versionFlag || '--version';
        // fill field compilerInfo.version,
        // assuming the compiler returns it's version on 1 line
        child_process.exec('"' + compiler + '" ' + versionFlag, function (err, output) {
            if (err) return resolve(null);
            compilerInfo.version = output.split('\n')[0];
            if (compilerInfo.intelAsm) {
                return resolve(compilerInfo);
            }

            // get informations on the compiler's options
            child_process.exec(compiler + ' --target-help', function (err, output) {
                var options = {};
                if (!err) {
                    var splitness = /--?[-a-zA-Z]+( ?[-a-zA-Z]+)/;
                    output.split('\n').forEach(function (line) {
                        var match = line.match(splitness);
                        if (!match) return;
                        options[match[0]] = true;
                    });
                }
                if (options['-masm']) {
                    compilerInfo.intelAsm = "-masm=intel";
                }

                // debug (seems to be displayed multiple times):
                if (opts.propDebug) console.log("compiler options: " + JSON.stringify(options, null, 4));

                resolve(compilerInfo);
            });
        });
    });
}

function findCompilers() {
    return configuredCompilers()
        .then(function (compilers) {
            return Promise.all(compilers.map(getCompilerInfo));
        })
        .then(function (compilers) {
            compilers = compilers.filter(function (x) {
                return x !== null;
            });
            compilers = compilers.sort(compareOn("name"));
            return compilers;
        });
}

// Instantiate a function that write informations on compiler,
// in JSON format (on which page ?)
function ApiHandler() {
    var reply = "";
    this.setCompilers = function (compilers) {
        reply = JSON.stringify(compilers);
    };
    this.handler = function apiHandler(req, res, next) {
        var bits = req.url.split("/");
        if (bits.length !== 2 || req.method !== "GET") return next();
        switch (bits[1]) {
            default:
                next();
                break;

            case "compilers":
                res.set('Content-Type', 'application/json');
                res.end(reply);
                break;
        }
    };
}

function shortUrlHandler(req, res, next) {
    var bits = req.url.split("/");
    if (bits.length !== 2 || req.method !== "GET") return next();
    var key = process.env.GOOGLE_API_KEY;
    var googleApiUrl = 'https://www.googleapis.com/urlshortener/v1/url?shortUrl=http://goo.gl/' +
        encodeURIComponent(bits[1]) + '&key=' + key;
    https.get(googleApiUrl, function (response) {
        var responseText = '';
        response.on('data', function (d) {
            responseText += d;
        });
        response.on('end', function () {
            if (response.statusCode != 200) {
                console.log("Failed to resolve short URL " + bits[1] + " - got response " +
                    response.statusCode + " : " + responseText);
                return next();
            }

            var resultObj = JSON.parse(responseText);
            var parsed = url.parse(resultObj.longUrl);
            var allowedRe = new RegExp(gccProps('allowedShortUrlHostRe'));
            if (parsed.host.match(allowedRe) === null) {
                console.log("Denied access to short URL " + bits[1] + " - linked to " + resultObj.longUrl);
                return next();
            }
            res.writeHead(301, {
                Location: resultObj.id,
                'Cache-Control': 'public'
            });
            res.end();
        });
    }).on('error', function (e) {
        res.end("TODO: error " + e.message);
    });
}

var clientOptionsHandler = new ClientOptionsHandler(fileSources);
var apiHandler = new ApiHandler();
var compileHandler = new CompileHandler();

findCompilers().then(function (compilers) {

    var prevCompilers = [];

    function onCompilerChange(compilers) {
        if (JSON.stringify(prevCompilers) == JSON.stringify(compilers)) {
            return;
        }
        console.log("Compilers:");
        compilers.forEach(function (c) {
            console.log(c.id + " : " + c.name + " : " + (c.exe || c.remote));
        });
        prevCompilers = compilers;
        clientOptionsHandler.setCompilers(compilers);
        apiHandler.setCompilers(compilers);
        compileHandler.setCompilers(compilers);
    }

    onCompilerChange(compilers);

    var rescanCompilerSecs = gccProps('rescanCompilerSecs', 0);
    if (rescanCompilerSecs) {
        console.log("Rescanning compilers every " + rescanCompilerSecs + "secs");
        setInterval(function () {
            findCompilers().then(onCompilerChange);
        }, rescanCompilerSecs * 1000);
    }

    var webServer = express(),
        sFavicon = require('serve-favicon'),
        sStatic = require('serve-static'),
        bodyParser = require('body-parser'),
        logger = require('morgan'),
        compression = require('compression'),
        restreamer = require('./lib/restreamer'),
        diffHandler = buildDiffHandler(wdiffConfig);

    webServer
        .use(logger('combined'))
        .use(compression())
        .use(sFavicon(staticDir + '/favicon.ico'))
        .use(sStatic(staticDir, {maxAge: staticMaxAgeSecs * 1000}))
        .use(bodyParser.json())
        .use(restreamer())
        .get('/client-options.json', clientOptionsHandler.handler)
        .use('/source', getSource)
        .use('/api', apiHandler.handler)
        .use('/g', shortUrlHandler)
        .post('/compile', compileHandler.handler) // used inside static/compiler.js
        .post('/diff', diffHandler); // used inside static/compiler.js

    // GO!
    console.log("=======================================");
    console.log("Listening on http://" + hostname + ":" + port + "/");
    console.log("  serving static files from '" + staticDir + "'");
    console.log("  git release " + gitReleaseName);
    console.log("=======================================");
    webServer.listen(port, hostname);
}).catch(function (err) {
    console.log("Error: " + err);
    process.exit(1);
});

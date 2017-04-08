// Copyright (c) 2012-2017, Matt Godbolt
//
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

var exec = require('./exec');
var _ = require('underscore');
var props = require('./properties');

// HACK HACK HACK
var formatters = props.propsFor("formatters");
var supportedTools = {};
var declaredFormatters = formatters('formatters','').split(':');
var declaredLanguages = formatters('languages','').split(':');

_.each(declaredFormatters, function (formatter) {
    var newTool = {name: formatter, instances:[], languages: []};
    var newFormatter = formatters(formatter, '').split(':');
    for (var i = 0;i < newFormatter.length;i += 2) {
        var newInstance = {};
        newInstance.version = newFormatter[i];
        newInstance.path = newFormatter[i + 1];
        newTool.instances.push(newInstance);
    }
    for (var j = 0;j < declaredLanguages.length;j += 2) {
        if (declaredLanguages[j] === formatter) {
            newTool.languages.push(declaredLanguages[j + 1]);
        }
    }
    supportedTools[formatter] = newTool;
});

// TODO: we'll need something smarter than this; URLs are long-lived and we nede
// to think about it; languages...formatters...etc.maybe something like:
function formatterHandler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    var response = {};
    var requestedTool = supportedTools[req.params.tool];
    if (!requestedTool) {
        response.exit = -2;
        response.thrown = true;
        response.answer = "Tool not supported";
        res.end(JSON.stringify(response));
    }
    var requestedInstance = null;
    if (!req.body.version) {
        requestedInstance = requestedTool.instances[requestedTool.instances.length - 1];
    } else {
        _.each(requestedTool.instances, function (instance) {
            if (instance.version === req.body.version) {
                requestedInstance = instance;
            }
        });
    }
    if (requestedInstance === null) {
        response.exit = -3;
        response.thrown = true;
        response.answer = "Requested version for " + req.params.tool + " not found";
        res.end(JSON.stringify(response));
    }
    var args = [];
    var options = {};
    // Only clang supported for now
    if (supportedTools.clang && requestedTool.name === supportedTools.clang.name) {
        var style = "Google";  // Default style
        if (req.body.base && req.body.base !== "None") {
            style = req.body.overrides ? '{"BasedOnStyle": ' + req.body.base + ', ' + req.body.overrides + '}' : req.body.base;
        } else if (req.body.overrides) {
            style = "{" + req.body.overrides + "}";
        }
        response.style = style;
        args.push("-style=" + style);
        options.input = req.body.source;
    }
    exec.execute(requestedInstance.path, args, options).then(function (result) {
        response.exit = result.code;
        response.answer = result.stdout;
        res.end(JSON.stringify(response));
    }).catch(function (ex) {
        response.exit = -1;
        response.thrown = true;
        response.answer = ex.message;
        res.end(JSON.stringify(response));
    });
}

function listerHandler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    var response = {};
    _.each(supportedTools, function (tool) {
        // Do we want this language?
        if (!req.body.language || tool.languages.indexOf(req.body.language) !== -1) {
            var versions = [];
            _.each(tool.instances, function (instance) {
                versions.push(instance.version);
            });
            response[tool.name] = {
                versions: versions,
                languages: tool.languages
            };
        }
    });
    res.end(JSON.stringify(response, null, 4));
}

module.exports = {
    formatterHandler: formatterHandler,
    listerHandler: listerHandler
};

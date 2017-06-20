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

var asm_doc = require('./asm-docs');
var props = require('./properties');

var asmProps = props.propsFor("asm-docs");
var staticMaxAgeSecs = asmProps('staticMaxAgeSecs', 10);

function docHandler(req, res, next) {
    var info = asm_doc.getAsmOpcode(req.params.opcode);
    if (!info) {
        // If the opcode ends with an AT&T suffix, try removing that and giving it another go.
        // Ideally, we'd be smarter here, but this is a quick win.
        var atAndTSuffixRemover = /^([A-Z]+)[BWLQ]$/;
        var suffixRemoved = atAndTSuffixRemover.exec(req.params.opcode);
        if (suffixRemoved) {
            info = asm_doc.getAsmOpcode(suffixRemoved[1]);
        }
    }
    if (staticMaxAgeSecs) {
        res.setHeader('Cache-Control', 'public, max-age=' + staticMaxAgeSecs);
    }
    if (req.accepts(['text', 'json']) == 'json') {
        res.set('Content-Type', 'application/json');
        res.end(JSON.stringify({found: !!info, result: info}));
    } else {
        res.set('Content-Type', 'text/html');
        if (info)
            res.end(info.html);
        else
            res.end("Unknown opcode");
    }
}

module.exports = {
    asmDocsHandler: docHandler
};

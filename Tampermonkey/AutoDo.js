// ==UserScript==
// @name         Easy Auto Do script
// @namespace    https://lhy-cpu.github.io
// @version      1.4
// @description  Make it easy to automatically do something.
// @author       lhy-cpu
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// @run-at       document-start
// @updateURL    https://lhy-cpu.github.io/Tampermonkey/AutoDo.js
// @downloadURL  https://lhy-cpu.github.io/Tampermonkey/AutoDo.js
// @homepage     https://lhy-cpu.github.io/Tampermonkey/index.html
// ==/UserScript==


(function () {
    'use strict';

    var configs = 
    {
        /*
            "*.example.com":
            {
                "autoClear": [".css-1ynzxqw"],
                "autoRemove": [".passport-login-container",".passport-login-tip-container.false",".left-toolbox"],
                "autoClick": [".toolbar-adver-btn",".open-btn"],
                "autoAddCSS" : 
                {
                    "code": "-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;",
                    "pre": "-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;",
                },
                "autoAddAttr": // !!! Important !!! This can overwrite the original attribute
                {
                    {"p":{"style": "overflow: hidden;","class":"forbid"}}
                }
            }

            // "ALL" is a global rule, it will be applied to all websites, which CANNOT be overwritten by specific rules.
            // "*" is a wildcard, it will be applied to all websites without specific rules, which CAN be overwritten by specific rules.
        */
        rules: 
        {
            "ALL":
            {
                "autoClear": [],
                "autoRemove": [],
                "autoClick": [],
                "autoAddStyle":[],
                "autoAddAttr":[]
            },
            "*":
            {
                "autoClear": [],
                "autoRemove": [],
                "autoClick": [],
                "autoAddStyle":[],
                "autoAddAttr":[]
            },
            "wenku.csdn.net":
            {
                "autoClear": [],
                "autoRemove": [".passport-login-container",".passport-login-tip-container.false",".left-toolbox","#content_bottom_fix_nav",".copy-btn",".top-bar","#page_bottom_fix_nav","div.open","div.vip"],
                "autoClick": [".open-btn"],
                "autoAddStyle": 
                [
                    {"code": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {"pre": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {".forbid": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {".cont.first-show":";max-height: none;"}
                ],
                "autoAddAttr":
                [
                ]
            },
            "blog.csdn.net":
            {
                "autoClear": [".css-1ynzxqw"],
                "autoRemove": [".passport-login-container",".passport-login-tip-container.false","div.left-toolbox",".hide-article-box.hide-article-pos.text-center",".hljs-button.signin.active",".btn-code-notes.mdeditor",".btn-code-notes.ckeditor",".code-edithtml.active","#asideWriteGuide",".box-shadow.mb8"],
                "autoClick": [".toolbar-adver-btn"],
                "autoAddStyle": 
                [
                    {"code": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {"pre": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {".forbid": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"}
                ],
                "autoAddAttr":
                [
                    {"div#article_content.article_content.clearfix":{"style": "overflow: hidden;"}}
                ]
            },
            "*.csdn.net":
            {
                "autoClear": [".css-1ynzxqw"],
                "autoRemove": [".passport-login-container",".passport-login-tip-container.false"],
                "autoClick": [".toolbar-adver-btn"],
                "autoAddStyle": 
                [
                    {"code": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {"pre": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"},
                    {".forbid": ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;"}
                ],
                "autoAddAttr":
                [
                ]
            },
            "*.zhihu.com":
            {
                "autoClear": [],
                "autoRemove": [".css-woosw9",".css-fxar0w"],
                "autoClick": [".Button.Modal-closeButton.Button--plain"],
                "autoAddStyle":[],
                "autoAddAttr":[]
            },
            "www.bilibili.com":
            {
                "autoClear": [],
                "autoRemove": ["[class^='paybar_payBarImageWrap__']","[class^='paybar_textWrap__']"],
                "autoClick": [".slide-gg>.close-btn",".ad-feedback-menu-dropdown>.feedback-module.reasons>.reasons-list>.reason"],
                "autoAddStyle":
                [
                    {".video-card-ad-small":";display:none;"}
                ],
                "autoAddAttr":[]
            }
        },
        preventListeners: ["copy"],
        loop_gap: 30
    };


    let oldadd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...args) {
        for (var i = 0; i < configs.preventListeners.length; i++) {
            if (type == configs.preventListeners[i]) {
                console.log("Prevent Listener: " + type);
                return oldadd.call(this, type, ()=>{});
            }
        }
        return oldadd.call(this, type, ...args);
    };

    var u = window.location.hostname;
    var rule = configs.rules.ALL;
    var t_r = configs.rules["*"];

    if(configs.rules[u] != undefined){
        t_r = configs.rules[u];
    }else if(configs.rules["*."+u.split(".").slice(1-u.split(".").length).join(".")] != undefined){
        t_r = configs.rules["*."+u.split(".").slice(1-u.split(".").length).join(".")];
    }

    rule.autoClick = rule.autoClick.concat(t_r.autoClick);
    rule.autoClear = rule.autoClear.concat(t_r.autoClear);
    rule.autoRemove = rule.autoRemove.concat(t_r.autoRemove);
    rule.autoAddStyle = rule.autoAddStyle.concat(t_r.autoAddStyle);
    rule.autoAddAttr = rule.autoAddAttr.concat(t_r.autoAddAttr);


    const loopFunc_s = (rule_name)=>{
        var rule_s = rule_name;

        rule_s.autoAddStyle.forEach((lis)=>{
            var ele = document.querySelectorAll(Object.keys(lis)[0]);
            for (var j = 0; j < ele.length; j++) {
                var tmp = ele[j].getAttribute("style");
                if(tmp==null) tmp = "";
                tmp += Object.values(lis)[0];
                ele[j].setAttribute("style",tmp);
            }
            rule_s.autoAddStyle.splice(rule_s.autoAddStyle.indexOf(lis),1);
        });

        rule_s.autoAddAttr.forEach((lis)=>{
            var ele = document.querySelectorAll(Object.keys(lis)[0]);
            for (var j = 0; j < ele.length; j++) {
                var attrs = Object.values(lis)[0];
                for(var i in attrs){
                    ele[j].setAttribute(i,attrs[i]);
                }
            }
            rule_s.autoAddAttr.splice(rule_s.autoAddAttr.indexOf(lis),1);
        });

        rule_s.autoClear.forEach((lis)=>{
            var ele = document.querySelectorAll(lis);
            for (var j = 0; j < ele.length; j++) {
                ele[j].innerHTML = "";
            }
        });

        rule_s.autoRemove.forEach((lis)=>{
            var ele = document.querySelectorAll(lis);
            for (var j = 0; j < ele.length; j++) {
                ele[j].remove();
            }
        });

        rule_s.autoClick.forEach((lis)=>{
            var ele = document.querySelectorAll(lis);
            for (var j = 0; j < ele.length; j++) {
                ele[j].click();
            }
        });
    };

    const generateToken = function(length) {
        var string = "abcdefghijklmnopqrstuvwxyz";
        var strUpper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var numeric = '0123456789';
        var token = "";
        token += string.charAt(Math.floor(string.length * Math.random()));
        while (token.length < length) {
            var way = Math.ceil(Math.random() * 3);
            switch (way) {
                case 1:
                    token += string.charAt(Math.floor(string.length * Math.random()));
                    break;
                case 2:
                    token += strUpper.charAt(Math.floor(strUpper.length * Math.random()));
                    break;
                case 3:
                    token += numeric.charAt(Math.floor(numeric.length * Math.random()));
                    break;
            }
        }
        return token;
    };

    var random_func_name = generateToken(Math.floor(10 * Math.random())+10);
    var random_rule_name = generateToken(Math.floor(10 * Math.random())+10);
    
    window.addEventListener("load", function () {
        rule.autoAddStyle.forEach((lis)=>{
            var ele = document.querySelectorAll(Object.keys(lis)[0]);
            for (var j = 0; j < ele.length; j++) {
                var tmp = ele[j].getAttribute("style");
                if(tmp==null) tmp = "";
                tmp += Object.values(lis)[0];
                ele[j].setAttribute("style",tmp);

            }
            rule.autoAddStyle.splice(rule.autoAddStyle.indexOf(lis),1);
        });

        rule.autoAddAttr.forEach((lis)=>{
            var ele = document.querySelectorAll(Object.keys(lis)[0]);
            for (var j = 0; j < ele.length; j++) {
                var attrs = Object.values(lis)[0];
                for(var i in attrs){
                    ele[j].setAttribute(i,attrs[i]);
                }
            }
            rule.autoAddAttr.splice(rule.autoAddAttr.indexOf(lis),1);
        });

        setTimeout("var "+random_func_name+" = "+loopFunc_s.toString(), 5);
        setTimeout("var "+random_rule_name+" = "+JSON.stringify(rule), 5);
        setInterval(random_func_name+"("+random_rule_name+");", configs.loop_gap);
    });
})();

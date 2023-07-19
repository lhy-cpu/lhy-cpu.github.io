// ==UserScript==
// @name         getCopyEasyScript
// @namespace    https://lhy-cpu.github.io
// @version      1.5
// @description  Make it easy to copy something and remove annoying login windows.
// @author       lhy-cpu
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// @run-at       document-start
// @updateURL    https://lhy-cpu.github.io/Tampermonkey/getCopy.js
// @downloadURL  https://lhy-cpu.github.io/Tampermonkey/getCopy.js
// @homepage     https://lhy-cpu.github.io/Tampermonkey/index.html
// ==/UserScript==


(function () {
    'use strict';
    let oldadd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...args) {
        if (type == "copy") {
            console.log("Prevent Copy");
            return 0;
        } else {
            return oldadd.call(this, type, ...args);
        }
    };
    window.addEventListener("load", function () {
        var doc = document.getElementsByTagName("pre");
        var acou;
        var tmp;
        for (acou = 0; acou < doc.length; acou++) {
            tmp = doc[acou].style;
            tmp += ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;";
            doc[acou].style = tmp;
        };
        doc = document.getElementsByTagName("code");
        for (acou = 0; acou < doc.length; acou++) {
            tmp = doc[acou].style;
            tmp += ";-webkit-touch-callout: auto;-webkit-user-select: auto;-khtml-user-select: auto;-moz-user-select: auto;-ms-user-select: auto;user-select: auto;";
            doc[acou].style = tmp;
        };
    });
    setInterval('var classArr = [".toolbar-adver-btn"];for (var i = 0; i < classArr.length; i++) {var aaa = document.querySelector(classArr[i]);if(aaa!=null){aaa.click()};};' +
     'var eleArr = [".css-1ynzxqw"];for(var i = 0; i < eleArr.length; i++){var tt = document.querySelector(eleArr[i]);if(tt!=null){tt.innerHTML = "";}};' +
     'var apc = document.querySelectorAll(".Button.Modal-closeButton.Button--plain");for(var i=0; i<apc.length; i++) {if (apc[i] != null && apc[i].parentNode.className == "Modal Modal--default signFlowModal") {apc[i].click();};}'+
     'var eee = document.querySelectorAll("span");for (var i = 0; i < eee.length; i++) {if (eee[i].innerText == "×" && eee[i].parentNode.className=="passport-login-box") {eee[i].click();}};', 10);
})();

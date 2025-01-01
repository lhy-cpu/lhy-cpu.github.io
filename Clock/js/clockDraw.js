class ClockDrawer{
    constructor(contentElementId,width,font){
        this.width = width;
        this.font = font;
        this.con = document.getElementById(contentElementId);
        var clock_can = document.createElement("canvas");
        clock_can.setAttribute("width", this.width);
        clock_can.setAttribute("height",this.width);
        this.con.appendChild(clock_can);
        this.canvas = clock_can;
    };
    removeCanvas(){
        this.con.removeChild(this.canvas);
    };
    drawSimpleClock(formattedTime) {
        this.drawGreaterClock(formattedTime,()=>{});
    };
    drawGreaterClock(formattedTime,callback){
        var clock = this.canvas.getContext("2d");
        var clockWidth = this.canvas.width;
        var hour = parseInt(formattedTime.split(":")[0]);
        var minute = parseInt(formattedTime.split(":")[1]);
        var second = parseFloat(formattedTime.split(":")[2]);
        // clock.reset();
        clock.beginPath();
        clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.48,0,2*Math.PI);
        clock.fillStyle = "#000000";
        clock.fill();
        clock.beginPath();
        clock.fillStyle = "#FFFFFF";
        clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.46,0,2*Math.PI);
        clock.fill();
        clock.beginPath();
        // clock.closePath();
        clock.fillStyle = "#000000";
        clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.014,0,2*Math.PI);
        clock.fill();
        clock.lineCap = "round";
        clock.lineWidth = clockWidth*0.005;
        clock.font = clockWidth*0.085+"px "+this.font;
        var textWidth = clock.measureText("1").width;
        //Draw clock text
        for(var i=1;i<13;i++) {
            var theta = i*Math.PI/6;
            clock.beginPath();
            clock.moveTo(clockWidth/2+clockWidth*0.47*Math.sin(theta),clockWidth/2-clockWidth*0.47*Math.cos(theta));
            clock.lineTo(clockWidth/2+clockWidth*0.43*Math.sin(theta),clockWidth/2-clockWidth*0.43*Math.cos(theta));
            clock.stroke();
            if(i<10){
                clock.fillText(i,clockWidth/2+clockWidth*0.38*Math.sin(theta)-textWidth/2,clockWidth/2-clockWidth*0.38*Math.cos(theta)+textWidth*0.65);
            }
            else{
                clock.fillText(i,clockWidth/2+clockWidth*0.38*Math.sin(theta)-textWidth,clockWidth/2-clockWidth*0.38*Math.cos(theta)+textWidth*0.65);
            }
    
        }
        callback();
        var theta = 0;
        //Draw hour pin
        theta = (hour+minute/60+second/3600)/6*Math.PI;
        clock.fillStyle = "#000000";
        clock.beginPath();
        clock.moveTo(clockWidth/2+clockWidth*0.25*Math.sin(theta),clockWidth/2-clockWidth*0.25*Math.cos(theta));
        clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta-Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta-Math.PI/2));
        clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta+Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta+Math.PI/2));
        clock.closePath();
        clock.fill();
    
        //Draw minute pin
        theta = (minute+second/60)/30*Math.PI;
        clock.fillStyle = "#000000";
        clock.beginPath();
        clock.moveTo(clockWidth/2+clockWidth*0.30*Math.sin(theta),clockWidth/2-clockWidth*0.30*Math.cos(theta));
        clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta-Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta-Math.PI/2));
        clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta+Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta+Math.PI/2));
        clock.closePath();
        clock.fill();
    
        //Draw second pin
        theta = second/30*Math.PI;
        clock.fillStyle = "#FF0000";
        clock.beginPath();
        clock.moveTo(clockWidth/2+clockWidth*0.35*Math.sin(theta),clockWidth/2-clockWidth*0.35*Math.cos(theta));
        clock.lineTo(clockWidth/2+clockWidth*0.1*Math.sin(theta-Math.PI*0.99),clockWidth/2-clockWidth*0.1*Math.cos(theta-Math.PI*0.99));
        clock.lineTo(clockWidth/2+clockWidth*0.1*Math.sin(theta+Math.PI*0.99),clockWidth/2-clockWidth*0.1*Math.cos(theta+Math.PI*0.99));
        // clock.moveTo(clockWidth/2,clockWidth/2);
        
        // clock.moveTo(clockWidth/2,clockWidth/2);
        
        clock.closePath();
        clock.fill();
    
        // clock.fillStyle = "#FF0000";
        clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.01,0,2*Math.PI);
        clock.fill();
    }

}
function createAClockCanvas(width) {
    var con = document.getElementById("clock_content");
    var clock_can = document.createElement("canvas");
    clock_can.setAttribute("width", width);
    clock_can.setAttribute("height",width);
    con.appendChild(clock_can);
    return clock_can;
};
function drawAClock(clockCanvas,time) {
    var clock = clockCanvas.getContext("2d");
    var clockWidth = clockCanvas.width;
    var hour = parseInt(time.split(":")[0]);
    var minute = parseInt(time.split(":")[1]);
    var second = parseFloat(time.split(":")[2]);
    // clock.reset();
    clock.beginPath();
    clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.48,0,2*Math.PI);
    clock.fillStyle = "#000000";
    clock.fill();
    clock.beginPath();
    clock.fillStyle = "#FFFFFF";
    clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.46,0,2*Math.PI);
    clock.fill();
    clock.beginPath();
    // clock.closePath();
    clock.fillStyle = "#000000";
    clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.014,0,2*Math.PI);
    clock.fill();
    clock.lineCap = "round";
    clock.lineWidth = clockWidth*0.005;
    clock.font = clockWidth*0.085+"px Harmony_Sans";
    var textWidth = clock.measureText("1").width;
    //Draw clock text
    for(var i=1;i<13;i++) {
        var theta = i*Math.PI/6;
        clock.beginPath();
        clock.moveTo(clockWidth/2+clockWidth*0.47*Math.sin(theta),clockWidth/2-clockWidth*0.47*Math.cos(theta));
        clock.lineTo(clockWidth/2+clockWidth*0.43*Math.sin(theta),clockWidth/2-clockWidth*0.43*Math.cos(theta));
        clock.stroke();
        if(i<10){
            clock.fillText(i,clockWidth/2+clockWidth*0.38*Math.sin(theta)-textWidth/2,clockWidth/2-clockWidth*0.38*Math.cos(theta)+textWidth*0.65);
        }
        else{
            clock.fillText(i,clockWidth/2+clockWidth*0.38*Math.sin(theta)-textWidth,clockWidth/2-clockWidth*0.38*Math.cos(theta)+textWidth*0.65);
        }

    }

    var theta = 0;
    //Draw hour pin
    theta = (hour+minute/60+second/3600)/6*Math.PI;
    clock.fillStyle = "#000000";
    clock.beginPath();
    clock.moveTo(clockWidth/2+clockWidth*0.25*Math.sin(theta),clockWidth/2-clockWidth*0.25*Math.cos(theta));
    clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta-Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta-Math.PI/2));
    clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta+Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta+Math.PI/2));
    clock.closePath();
    clock.fill();

    //Draw minute pin
    theta = (minute+second/60)/30*Math.PI;
    clock.fillStyle = "#000000";
    clock.beginPath();
    clock.moveTo(clockWidth/2+clockWidth*0.30*Math.sin(theta),clockWidth/2-clockWidth*0.30*Math.cos(theta));
    clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta-Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta-Math.PI/2));
    clock.lineTo(clockWidth/2+clockWidth*0.014*Math.sin(theta+Math.PI/2),clockWidth/2-clockWidth*0.014*Math.cos(theta+Math.PI/2));
    clock.closePath();
    clock.fill();

    //Draw second pin
    theta = second/30*Math.PI;
    clock.fillStyle = "#FF0000";
    clock.beginPath();
    clock.moveTo(clockWidth/2+clockWidth*0.35*Math.sin(theta),clockWidth/2-clockWidth*0.35*Math.cos(theta));
    clock.lineTo(clockWidth/2+clockWidth*0.1*Math.sin(theta-Math.PI*0.99),clockWidth/2-clockWidth*0.1*Math.cos(theta-Math.PI*0.99));
    clock.lineTo(clockWidth/2+clockWidth*0.1*Math.sin(theta+Math.PI*0.99),clockWidth/2-clockWidth*0.1*Math.cos(theta+Math.PI*0.99));
    // clock.moveTo(clockWidth/2,clockWidth/2);
    
    // clock.moveTo(clockWidth/2,clockWidth/2);
    
    clock.closePath();
    clock.fill();

    // clock.fillStyle = "#FF0000";
    clock.arc(clockWidth/2,clockWidth/2,clockWidth*0.01,0,2*Math.PI);
    clock.fill();


};

// export {ClockDrawer as ClockDrawer};
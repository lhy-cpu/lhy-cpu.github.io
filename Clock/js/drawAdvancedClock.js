class AdvancedClockDrawer{
    constructor(canvasWidth,fontShowColor,contentElementId) {
        this.canvasWidth = canvasWidth;
        this.clock = new ClockDrawer(contentElementId,canvasWidth,"Harmony_Sans");
        this.canvas = this.clock.canvas;
        this.digital = new DigitalNumberDrawerInCanvas(this.canvas,canvasWidth*0.05,fontShowColor,"#4e4e4e","#444444");
        
    };
    drawClock(formattedTime,callback){
        this.clock.drawGreaterClock(formattedTime,()=>{
            this.digital.drawHMSTime(formattedTime.split(":")[0],formattedTime.split(":")[1],[0,Math.floor(formattedTime.split(":")[2])].join('').slice(-2),this.canvasWidth*0.3,this.canvasWidth*0.65);
            callback(this.canvas.getContext("2d"),this.canvasWidth);
        });
    };
    removeClock(){
        this.clock.removeCanvas();
    };
}
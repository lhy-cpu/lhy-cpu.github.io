class DigitalNumberDrawerInCanvas{
    constructor(canvas,width,fontShowColor,fontNoShowColor,backgroundColor){
        this.canvas = canvas;
        this.width = width;
        this.fontShowColor = fontShowColor;
        this.fontNoShowColor = fontNoShowColor;
        this.backgroundColor = backgroundColor;
        this.dn = this.canvas.getContext("2d");
    };

    drawDA(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/8,y+this.width/20);
        this.dn.lineTo(x+this.width/8*7,y+this.width/20);
        this.dn.lineTo(x+this.width/400*364,y+this.width/400*34);
        this.dn.lineTo(x+this.width/400*328,y+this.width/40*7);
        this.dn.lineTo(x+this.width/400*72,y+this.width/40*7);
        this.dn.lineTo(x+this.width/400*36,y+this.width/400*34);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDB(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/400*366,y+this.width/400*36);
        this.dn.lineTo(x+this.width/400*380,y+this.width/8);
        this.dn.lineTo(x+this.width/400*380,y+this.width/400*398);
        this.dn.lineTo(x+this.width/400*330,y+this.width/400*373);
        this.dn.lineTo(x+this.width/400*330,y+this.width/400*72);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDC(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/400*366,y+this.width/400*364+this.width);
        this.dn.lineTo(x+this.width/400*380,y+this.width/8*7+this.width);
        this.dn.lineTo(x+this.width/400*380,y+this.width/400*2+this.width);
        this.dn.lineTo(x+this.width/400*330,y+this.width/400*27+this.width);
        this.dn.lineTo(x+this.width/400*330,y+this.width/400*328+this.width);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDD(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/8,y+this.width/400*380+this.width);
        this.dn.lineTo(x+this.width/8*7,y+this.width/400*380+this.width);
        this.dn.lineTo(x+this.width/400*364,y+this.width/400*366+this.width);
        this.dn.lineTo(x+this.width/400*328,y+this.width/400*330+this.width);
        this.dn.lineTo(x+this.width/400*72,y+this.width/400*330+this.width);
        this.dn.lineTo(x+this.width/400*36,y+this.width/400*366+this.width);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDE(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/400*34,y+this.width/400*364+this.width);
        this.dn.lineTo(x+this.width/400*20,y+this.width/8*7+this.width);
        this.dn.lineTo(x+this.width/400*20,y+this.width/400*2+this.width);
        this.dn.lineTo(x+this.width/400*70,y+this.width/400*27+this.width);
        this.dn.lineTo(x+this.width/400*70,y+this.width/400*328+this.width);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDF(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/400*34,y+this.width/400*36);
        this.dn.lineTo(x+this.width/400*20,y+this.width/8);
        this.dn.lineTo(x+this.width/400*20,y+this.width/400*398);
        this.dn.lineTo(x+this.width/400*70,y+this.width/400*373);
        this.dn.lineTo(x+this.width/400*70,y+this.width/400*72);
        this.dn.closePath();
        this.dn.fill();
    };
    drawDG(x,y,fontColor){
        this.dn.fillStyle = fontColor;
        this.dn.beginPath();
        this.dn.moveTo(x+this.width/400*20,y+this.width);
        this.dn.lineTo(x+this.width/400*70,y+this.width/400*25+this.width);
        this.dn.lineTo(x+this.width/400*330,y+this.width/400*25+this.width);
        this.dn.lineTo(x+this.width/400*380,y+this.width);
        this.dn.lineTo(x+this.width/400*330,y+this.width-this.width/400*25);
        this.dn.lineTo(x+this.width/400*70,y+this.width-this.width/400*25);
        this.dn.closePath();
        this.dn.fill();
    };

    drawNumberOne(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontNoShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontNoShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontNoShowColor);
        this.drawDG(x,y,this.fontNoShowColor);
    };
    drawNumberTwo(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontNoShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontShowColor);
        this.drawDF(x,y,this.fontNoShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberThree(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontNoShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberFour(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontNoShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontNoShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberFive(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontNoShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberSix(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontNoShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberSeven(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontNoShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontNoShowColor);
        this.drawDG(x,y,this.fontNoShowColor);
    };
    drawNumberEight(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberNine(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontNoShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontShowColor);
    };
    drawNumberZero(x,y){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x,y,this.width,this.width*2);
        this.drawDA(x,y,this.fontShowColor);
        this.drawDB(x,y,this.fontShowColor);
        this.drawDC(x,y,this.fontShowColor);
        this.drawDD(x,y,this.fontShowColor);
        this.drawDE(x,y,this.fontShowColor);
        this.drawDF(x,y,this.fontShowColor);
        this.drawDG(x,y,this.fontNoShowColor);
    };
    drawNumber(number,x,y){
        if(number==1){
            this.drawNumberOne(x,y);
        }
        else if(number==2){
            this.drawNumberTwo(x,y);
        }
        else if(number==3){
            this.drawNumberThree(x,y);
        }
        else if(number==4){
            this.drawNumberFour(x,y);
        }
        else if(number==5){
            this.drawNumberFive(x,y);
        }
        else if(number==6){
            this.drawNumberSix(x,y);
        }
        else if(number==7){
            this.drawNumberSeven(x,y);
        }
        else if(number==8){
            this.drawNumberEight(x,y);
        }
        else if(number==9){
            this.drawNumberNine(x,y);
        }
        else if(number==0){
            this.drawNumberZero(x,y);
        }
    };

    drawNumbers(numbers,x,y){
        var numLen = numbers.toString().length;
        var pos = x;
        for(var i = 0; i < numLen; i++){
            this.dn.fillStyle = this.backgroundColor;
            this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
            pos += this.width*0.125-1;
            this.drawNumber(numbers.toString()[i],pos,y);
            pos+=this.width-1;
            this.dn.fillStyle = this.backgroundColor;
            this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
            pos += this.width*0.125-1;
        }
        return pos;
    }

    drawHMSTime(hour,minute,second,x,y){
        // this.dn.fillStyle = this.backgroundColor;
        // this.dn.fillRect(x,y,this.width*6.8,this.width*2);
        var pointFillStyle;
        var pointOnePos = 0;
        var pointTwoPos = 0;
        if(second%2==0){
            pointFillStyle = this.fontShowColor;
        }
        else{
            pointFillStyle = this.fontNoShowColor;
        }
        var pos = x;
        // if(hour<10){
        //     this.dn.fillStyle = this.backgroundColor;
        //     this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
        //     pos += this.width*0.125-1;
        //     this.drawNumber(0,pos,y);
        //     pos+=this.width-1;
        //     this.dn.fillStyle = this.backgroundColor;
        //     this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
        //     pos += this.width*0.125-1;
        //     this.dn.fillStyle = this.backgroundColor;
        //     this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
        //     pos += this.width*0.125-1;
        //     this.drawNumber(hour,pos,y);
        //     pos+=this.width-1;
        //     this.dn.fillStyle = this.backgroundColor;
        //     this.dn.fillRect(pos,y,this.width*0.125,this.width*2);
        //     pos += this.width*0.125-1;
        // }
        // else{
        //     pos = this.drawNumbers(hour,pos,y);
        // }
        pos = this.drawNumbers(hour,pos,y);
        pointOnePos = pos+this.width*0.125;
        pos+= this.width*0.25;

        // this.dn.beginPath();
        // this.dn.arc(pos,y+this.width*1.3,y+this.width*0.1,0,2*Math.PI);
        // this.dn.arc(pos,y+this.width*0.7,y+this.width*0.1,0,2*Math.PI);
        // this.dn.fillStyle = pointFillStyle;
        // this.dn.fill();
        // if(minute<10){

        //     this.drawNumber(0,pos,y);
        //     pos += this.width;
        //     this.drawNumber(minute,pos,y);
        //     pos += this.width;
        // }
        // else{
        //     pos = this.drawNumbers(minute,pos,y);
        // }
        pos = this.drawNumbers(minute,pos,y);
        pointTwoPos = pos+this.width*0.125;
        pos+= this.width*0.25;
        
        // if(second<10){
        //     this.drawNumber(0,pos,y);
        //     pos += this.width;
        //     this.drawNumber(second,pos,y);
        //     pos += this.width;
        // }
        // else{
        //     pos = this.drawNumbers(second,pos,y);
        // }
        pos = this.drawNumbers(second,pos,y);
        this.drawTimePoint(pointOnePos,y,pointFillStyle);
        this.drawTimePoint(pointTwoPos,y,pointFillStyle);

    };

    drawTimePoint(x,y,pointFillStyle){
        this.dn.fillStyle = this.backgroundColor;
        this.dn.fillRect(x-this.width*0.125,y,this.width*0.25+1,this.width*2);
        this.dn.beginPath();
        this.dn.arc(x,y+this.width*1.3,this.width*0.1,0,2*Math.PI);
        this.dn.arc(x,y+this.width*0.7,this.width*0.1,0,2*Math.PI);
        this.dn.fillStyle = pointFillStyle;
        this.dn.fill();
    };




}



// function drawDigitalNumberInCanvas(canvas,x,y,width,fontColor,backgroundColor){
//     var dn = canvas.getContext("2d");
//     dn.fillStyle = backgroundColor;
//     dn.fillRect(x,y,width,width*2);
//     // dn.beginPath();
//     // dn.moveTo(x,y);
//     // dn.lineTo(x+width,y);
//     // dn.lineTo(x+width,y+width*2);
//     // dn.lineTo(x,y+width*2);
//     // dn.closePath();
//     // dn.fill();
// //d
// //b
// //e
// //c
// //g
// }



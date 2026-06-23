import CONFIG from './config.js';

class CameraSystem {

  constructor(canvas){

    this.canvas=canvas;

    this.x=0;
    this.y=0;

    this.zoom=CONFIG.CAMERA_BASE_ZOOM;

    this.targetX=0;
    this.targetY=0;

    this.targetZoom=CONFIG.CAMERA_BASE_ZOOM;
  }



  update(targetDragon,arena){

    if(!targetDragon) return;

    if(targetDragon.state!=='alive') return;

    if(!targetDragon.head) return;



    const head=targetDragon.head;



    // FOLLOW THE HEAD DIRECTLY

    const leadX=

      Math.cos(head.angle)

      *CONFIG.CAMERA_LEAD_DISTANCE;



    const leadY=

      Math.sin(head.angle)

      *CONFIG.CAMERA_LEAD_DISTANCE;



    this.targetX=head.x+leadX;

    this.targetY=head.y+leadY;



    // SMALL ZOOM OUT AS DRAGON GROWS

    const extraSegments=Math.max(

      0,

      targetDragon.length-

      CONFIG.DRAGON_START_SEGMENTS

    );



    this.targetZoom=

      CONFIG.CAMERA_BASE_ZOOM

      -(extraSegments*0.003);



    this.targetZoom=Math.max(

      CONFIG.CAMERA_MIN_ZOOM,

      Math.min(

        CONFIG.CAMERA_MAX_ZOOM,

        this.targetZoom

      )

    );



    // SMOOTH FOLLOW

    this.x+=(

      this.targetX-this.x

    )*0.12;



    this.y+=(

      this.targetY-this.y

    )*0.12;



    this.zoom+=(

      this.targetZoom-this.zoom

    )*0.08;



    // KEEP INSIDE ARENA

    if(arena){

      const bounds=arena.getBounds();



      const viewWidth=

        this.canvas.width/

        this.zoom;



      const viewHeight=

        this.canvas.height/

        this.zoom;



      const halfW=viewWidth/2;

      const halfH=viewHeight/2;



      this.x=Math.max(

        bounds.minX+halfW,

        Math.min(

          bounds.maxX-halfW,

          this.x

        )

      );



      this.y=Math.max(

        bounds.minY+halfH,

        Math.min(

          bounds.maxY-halfH,

          this.y

        )

      );

    }

  }



  worldToScreen(wx,wy){

    const cx=this.canvas.width/2;

    const cy=this.canvas.height/2;



    return{

      x:(wx-this.x)*this.zoom+cx,

      y:(wy-this.y)*this.zoom+cy

    };

  }



  screenToWorld(sx,sy){

    const cx=this.canvas.width/2;

    const cy=this.canvas.height/2;



    return{

      x:(sx-cx)/this.zoom+this.x,

      y:(sy-cy)/this.zoom+this.y

    };

  }



  apply(ctx){

    const cx=this.canvas.width/2;

    const cy=this.canvas.height/2;



    ctx.setTransform(

      this.zoom,

      0,

      0,

      this.zoom,

      cx-(this.x*this.zoom),

      cy-(this.y*this.zoom)

    );

  }



  reset(ctx){

    ctx.setTransform(

      1,

      0,

      0,

      1,

      0,

      0

    );

  }



  isInView(x,y,margin=100){

    const pos=this.worldToScreen(

      x,

      y

    );



    return(

      pos.x>-margin &&

      pos.x<this.canvas.width+margin &&

      pos.y>-margin &&

      pos.y<this.canvas.height+margin

    );

  }

}

export default CameraSystem;

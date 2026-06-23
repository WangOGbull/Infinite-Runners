import CONFIG from './config.js';
import AssetLoader from './assetLoader.js';

class Dragon {

  constructor(id,name,x,y,teamId=null){

    this.id=id;
    this.name=name;
    this.teamId=teamId;

    this.asset=AssetLoader.getDragonByName(name);

    this.state='alive';

    this.score=0;
    this.collected=0;
    this.kills=0;

    this.x=x;
    this.y=y;

    this.angle=0;

    this.speed=CONFIG.DRAGON_BASE_SPEED;

    this.boostActive=false;

    this.history=[];

    this.segments=[];

    this.segmentSize=100;

    this.initializeDragon();
  }



  initializeDragon(){

    this.segments=[];

    this.history=[];

    const spacing=55;

    for(let i=0;i<CONFIG.DRAGON_START_SEGMENTS;i++){

      let type='body';

      if(i===0){

        type='head';

      }

      else if(i===CONFIG.DRAGON_START_SEGMENTS-1){

        type='tail';

      }

      this.segments.push({

        x:this.x-(i*spacing),

        y:this.y,

        angle:0,

        type

      });

    }


    for(let i=0;i<CONFIG.POSITION_HISTORY_BUFFER_SIZE;i++){

      this.history.push({

        x:this.x,

        y:this.y,

        angle:0

      });

    }

  }



  get head(){

    return this.segments[0];

  }


  get tail(){

    return this.segments[this.segments.length-1];

  }


  get length(){

    return this.segments.length;

  }



  update(deltaTime,inputAngle){

    if(this.state!=='alive') return;



    let diff=inputAngle-this.angle;



    while(diff>Math.PI){

      diff-=Math.PI*2;

    }



    while(diff<-Math.PI){

      diff+=Math.PI*2;

    }



    this.angle+=diff*CONFIG.DRAGON_TURN_SPEED*(deltaTime/16);



    let speed=CONFIG.DRAGON_BASE_SPEED;



    if(this.boostActive){

      speed*=1.8;

    }



    const head=this.head;



    head.x+=Math.cos(this.angle)*speed*(deltaTime/16);

    head.y+=Math.sin(this.angle)*speed*(deltaTime/16);

    head.angle=this.angle;



    this.history.unshift({

      x:head.x,

      y:head.y,

      angle:this.angle

    });



    if(this.history.length>CONFIG.POSITION_HISTORY_BUFFER_SIZE){

      this.history.pop();

    }



    const spacing=55;



    for(let i=1;i<this.segments.length;i++){

      const seg=this.segments[i];



      const historyIndex=i*7;



      const historyPoint=this.history[Math.min(

        historyIndex,

        this.history.length-1

      )];



      if(!historyPoint) continue;



      seg.x=historyPoint.x;

      seg.y=historyPoint.y;



      seg.angle=historyPoint.angle;

    }

  }



  grow(amount=1){

    for(let i=0;i<amount;i++){



      if(this.segments.length>=CONFIG.DRAGON_MAX_SEGMENTS){

        break;

      }



      const tail=this.tail;



      this.segments.splice(

        this.segments.length-1,

        0,

        {

          x:tail.x,

          y:tail.y,

          angle:tail.angle,

          type:'body'

        }

      );

    }



    this.collected+=amount;

    this.score+=amount*CONFIG.FOOD_NORMAL_POINTS;

  }



  shrink(amount){

    for(let i=0;i<amount;i++){



      if(this.segments.length<=CONFIG.DRAGON_START_SEGMENTS){

        break;

      }



      this.segments.splice(

        this.segments.length-2,

        1

      );

    }

  }



  render(ctx,camera){

    if(!this.asset) return;



    const scale=camera.zoom*CONFIG.DRAGON_DISPLAY_SCALE;



    for(let i=this.segments.length-1;i>=0;i--){



      const seg=this.segments[i];



      let sprite;



      if(seg.type==='head'){

        sprite=this.asset.head;

      }

      else if(seg.type==='tail'){

        sprite=this.asset.tail;

      }

      else{

        sprite=this.asset.body;

      }



      if(!sprite) continue;



      const pos=camera.worldToScreen(

        seg.x,

        seg.y

      );



      ctx.save();



      ctx.translate(

        pos.x,

        pos.y

      );



      ctx.rotate(

        seg.angle

      );



      let width=sprite.width*scale;

      let height=sprite.height*scale;



      if(seg.type==='head'){

        width*=0.9;

        height*=0.9;

      }



      if(seg.type==='body'){

        width*=0.85;

        height*=0.85;

      }



      if(seg.type==='tail'){

        width*=0.8;

        height*=0.8;

      }



      ctx.drawImage(

        sprite,

        -width/2,

        -height/2,

        width,

        height

      );



      ctx.restore();

    }

  }



  getBounds(){

    let minX=Infinity;

    let minY=Infinity;

    let maxX=-Infinity;

    let maxY=-Infinity;



    for(const seg of this.segments){

      minX=Math.min(minX,seg.x);

      minY=Math.min(minY,seg.y);

      maxX=Math.max(maxX,seg.x);

      maxY=Math.max(maxY,seg.y);

    }



    return{

      minX,

      minY,

      maxX,

      maxY

    };

  }



  destroy(){

    this.state='dead';

    this.history=[];

    this.segments=[];

  }

}



class DragonManager{

  constructor(){

    this.dragons=new Map();

    this.nextId=1;
  }



  createDragon(name,x,y,teamId=null){

    const id=`dragon_${this.nextId++}`;



    const dragon=new Dragon(

      id,

      name,

      x,

      y,

      teamId

    );



    this.dragons.set(

      id,

      dragon

    );



    return dragon;
  }



  removeDragon(id){

    const dragon=this.dragons.get(id);



    if(!dragon) return;



    dragon.destroy();



    this.dragons.delete(id);
  }



  getDragon(id){

    return this.dragons.get(id);

  }



  getAllDragons(){

    return Array.from(

      this.dragons.values()

    );

  }



  getLivingDragons(){

    return this.getAllDragons()

      .filter(

        dragon=>dragon.state==='alive'

      );

  }



  update(deltaTime,inputMap){

    for(const dragon of this.dragons.values()){

      const input=inputMap.get(dragon.id)

      ?? dragon.angle;



      dragon.update(

        deltaTime,

        input

      );

    }

  }



  render(ctx,camera){

    for(const dragon of this.dragons.values()){

      if(dragon.state==='alive'){

        dragon.render(

          ctx,

          camera

        );

      }

    }

  }



  clear(){

    for(const dragon of this.dragons.values()){

      dragon.destroy();

    }



    this.dragons.clear();



    this.nextId=1;
  }

}



export { Dragon, DragonManager };

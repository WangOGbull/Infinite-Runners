import CONFIG from './config.js';

class FoodSystem {

  constructor(eventBus){

    this.eventBus=eventBus;

    this.foods=new Map();

    this.nextId=1;

    this.arenaBounds=null;



    this.colors=[

      '#00e5ff', // aegis

      '#ff6b35', // ignis

      '#b967ff', // infinite

      '#00ff9d'  // magnetron

    ];
  }



  init(arenaBounds){

    this.arenaBounds=arenaBounds;



    this.foods.clear();



    this.nextId=1;



    const area=

      (arenaBounds.maxX-arenaBounds.minX)

      *

      (arenaBounds.maxY-arenaBounds.minY);



    const foodCount=Math.floor(

      area*0.00007

    );



    for(

      let i=0;

      i<foodCount;

      i++

    ){

      this.spawnFood();

    }

  }



  spawnFood(){

    if(!this.arenaBounds){

      return;

    }



    const id=`food_${this.nextId++}`;



    const color=

      this.colors[

        Math.floor(

          Math.random()

          *

          this.colors.length

        )

      ];



    const bonus=

      Math.random()<0.04;



    const food={

      id,



      x:

      this.arenaBounds.minX+

      Math.random()*

      (

        this.arenaBounds.maxX-

        this.arenaBounds.minX

      ),



      y:

      this.arenaBounds.minY+

      Math.random()*

      (

        this.arenaBounds.maxY-

        this.arenaBounds.minY

      ),



      radius:bonus?8:5,



      color,



      value:bonus?2:1,



      bonus,



      pulse:0

    };



    this.foods.set(

      id,

      food

    );



    return food;
  }



  removeFood(id){

    if(

      !this.foods.has(id)

    ){

      return;

    }



    this.foods.delete(id);



    setTimeout(

      ()=>{

        this.spawnFood();

      },

      CONFIG.FOOD_RESPAWN_DELAY

    );

  }



  update(deltaTime){

    for(

      const food

      of

      this.foods.values()

    ){

      food.pulse+=0.05;

    }

  }



  getFoodInRadius(

    x,

    y,

    radius

  ){

    const result=[];



    for(

      const food

      of

      this.foods.values()

    ){

      const dx=

        food.x-x;



      const dy=

        food.y-y;



      const dist=

        Math.sqrt(

          dx*dx+

          dy*dy

        );



      if(

        dist<

        radius+

        food.radius

      ){

        result.push(food);

      }

    }



    return result;
  }



  render(ctx,camera){

    for(

      const food

      of

      this.foods.values()

    ){

      if(

        !camera.isInView(

          food.x,

          food.y,

          40

        )

      ){

        continue;

      }



      const pos=

        camera.worldToScreen(

          food.x,

          food.y

        );



      const size=

      food.radius*

      camera.zoom*

      (

        1+

        Math.sin(

          food.pulse

        )*

        0.1

      );



      ctx.save();



      ctx.shadowColor=

        food.color;



      ctx.shadowBlur=

        12;



      ctx.fillStyle=

        food.color;



      ctx.font=

        `${size*2}px Arial`;



      ctx.textAlign=

        'center';



      ctx.textBaseline=

        'middle';



      ctx.fillText(

        '∞',

        pos.x,

        pos.y

      );



      ctx.restore();

    }

  }



  getFoods(){

    return Array.from(

      this.foods.values()

    );

  }

}

export default FoodSystem;

import CONFIG,{DRAGONS} from './config.js';

class AssetLoader{

  constructor(){

    this.loadedDragons=[];

    this.cache=new Map();
  }



  async loadImage(src){

    if(

      this.cache.has(src)

    ){

      return this.cache.get(src);

    }



    return new Promise(

      (resolve,reject)=>{

        const img=new Image();



        img.crossOrigin='anonymous';



        img.onload=()=>{

          this.cache.set(

            src,

            img

          );



          resolve(img);
        };



        img.onerror=()=>{

          reject(src);
        };



        img.src=src;
      }

    );

  }



  async loadDragons(){

    const dragons=[];



    for(

      const name

      of

      DRAGONS

    ){



      const headSrc=

      `${CONFIG.ASSET_BASE_URL}${name}_head.png`;



      const bodySrc=

      `${CONFIG.ASSET_BASE_URL}${name}_body.png`;



      const tailSrc=

      `${CONFIG.ASSET_BASE_URL}${name}_tail.png`;



      try{



        const [

          head,

          body,

          tail

        ]

        =

        await Promise.all([

          this.loadImage(headSrc),

          this.loadImage(bodySrc),

          this.loadImage(tailSrc)

        ]);



        dragons.push({

          name,



          head,

          body,

          tail,



          headSrc,

          bodySrc,

          tailSrc,



          // NORMALIZED VALUES



          display:{



            head:{

              scale:0.95
            },



            body:{

              scale:0.85
            },



            tail:{

              scale:0.8
            }

          }

        });

      }

      catch(error){

        console.warn(

          `Dragon asset failed: ${name}`

        );

      }

    }



    this.loadedDragons=

      dragons;



    return dragons;
  }



  getDragonByName(name){

    return this.loadedDragons.find(

      dragon=>

      dragon.name===name

    );

  }



  getAllDragons(){

    return this.loadedDragons;

  }



  clear(){

    this.loadedDragons=[];

    this.cache.clear();
  }

}

export default new AssetLoader();

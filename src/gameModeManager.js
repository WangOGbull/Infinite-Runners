import CONFIG from './config.js';

class GameModeManager {

  constructor(){

    this.mode='FFA';
  }



  setMode(mode){

    if(

      CONFIG.GAME_MODES.includes(mode)

    ){

      this.mode=mode;

    }

    else{

      this.mode='FFA';

    }

  }



  getMode(){

    return this.mode;

  }



  getMaxPlayers(){

    return(

      CONFIG.MAX_PLAYERS[

        this.mode

      ]

      ||

      CONFIG.MAX_PLAYERS.FFA

    );

  }



  getDuration(){

    return(

      CONFIG.GAME_DURATION[

        this.mode

      ]

      ||

      CONFIG.GAME_DURATION.FFA

    );

  }



  getArenaSize(){

    return(

      CONFIG.ARENA[

        this.mode

      ]

      ||

      CONFIG.ARENA.FFA

    );

  }



  getTeamForPlayer(playerIndex){

    switch(this.mode){

      case '1v1':

        return playerIndex%2;



      case '2v2':

        return Math.floor(

          playerIndex/2

        );



      case '4v4':

        return Math.floor(

          playerIndex/4

        );



      default:

        return playerIndex;
    }

  }



  checkWinCondition(dragons){

    const alive=dragons.filter(

      dragon

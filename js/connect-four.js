"use strict";
(() => {
  let gameOver = false;
  let gameStarted = false;
  let animationMode = false;
  class Board {
    constructor(game, gameBoardArray, player) {
      this.game = game;
      this.gameBoardArray = gameBoardArray;
      this.player = player;
    }

    isFinished(depth, score) {
      if (
        depth === 0 ||
        score === this.game.score ||
        score === -this.game.score ||
        this.isFull()
      ) {
        return true;
      }
      return false;
    }

    columnIsFull(col) {
      for (let y = this.game.rows - 1; y >= 0; y--) {
        if (this.gameBoardArray[y][col] === null) {
          return false;
        }
      }
      return true;
    }

    placeInColumnForQuickMove(col, playerValue) {
      for (let y = this.game.rows - 1; y >= 0; y--) {
        if (this.gameBoardArray[y][col] === null) {
          this.gameBoardArray[y][col] = playerValue;
          break;
        }
      }
    }

    canPlace(column) {
      if (
        this.gameBoardArray[0][column] === null &&
        column >= 0 &&
        column < this.game.columns
      ) {
        for (let y = this.game.rows - 1; y >= 0; y--) {
          if (this.gameBoardArray[y][column] === null) {
            this.gameBoardArray[y][column] = this.player;
            break;
          }
        }
        this.player = this.player === 0 ? 1 : 0;

        return true;
      } else {
        return false;
      }
    }

    scoreBoard(row, column, deltaY, deltaX) {
      let humanPoints = 0;
      let computerPoints = 0;
      let internalRow = row;
      let internalCol = column;
      this.game.winningArrayHuman = [];
      this.game.winningArrayCpu = [];

      for (let i = 0; i < 4; i++) {
        if (this.gameBoardArray[internalRow][internalCol] === 0) {
          this.game.winningArrayHuman.push([internalRow, internalCol]);
          humanPoints++;
        } else if (this.gameBoardArray[internalRow][internalCol] === 1) {
          this.game.winningArrayCpu.push([internalRow, internalCol]);
          computerPoints++;
        }
        internalRow = internalRow + deltaY;
        internalCol = internalCol + deltaX;
      }
      if (humanPoints === 4) {
        this.game.winners = this.game.winningArrayHuman;
        return -this.game.score;
      } else if (computerPoints === 4) {
        this.game.winners = this.game.winningArrayCpu;
        return this.game.score;
      } else {
        return computerPoints;
      }
    }

    evaluateScore() {
      let verticalPoints = 0;
      let horizontalPoints = 0;
      let diagonalPoints1 = 0;
      let diagonalPoints2 = 0;
      for (let row = 0; row < this.game.rows - 3; row++) {
        for (let column = 0; column < this.game.columns; column++) {
          const score = this.scoreBoard(row, column, 1, 0);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          verticalPoints = verticalPoints + score;
        }
      }
      for (let row = 0; row < this.game.rows; row++) {
        for (let column = 0; column < this.game.columns - 3; column++) {
          const score = this.scoreBoard(row, column, 0, 1);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          horizontalPoints = horizontalPoints + score;
        }
      }
      for (let row = 0; row < this.game.rows - 3; row++) {
        for (let column = 0; column < this.game.columns - 3; column++) {
          const score = this.scoreBoard(row, column, 1, 1);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          diagonalPoints1 = diagonalPoints1 + score;
        }
      }
      for (let row = 3; row < this.game.rows; row++) {
        for (let column = 0; column <= this.game.columns - 4; column++) {
          const score = this.scoreBoard(row, column, -1, +1);
          if (score === this.game.score) return this.game.score;
          if (score === -this.game.score) return -this.game.score;
          diagonalPoints2 = diagonalPoints2 + score;
        }
      }
      return (
        horizontalPoints + verticalPoints + diagonalPoints1 + diagonalPoints2
      );
    }

    isFull() {
      for (let i = 0; i < this.game.columns; i++) {
        if (this.gameBoardArray[0][i] === null) {
          return false;
        }
      }
      return true;
    }

    getBoardCopy() {
      const newBoard = [];
      for (let i = 0; i < this.gameBoardArray.length; i++) {
        newBoard.push(this.gameBoardArray[i].slice());
      }
      return new Board(this.game, newBoard, this.player);
    }
  }

  class Game {
    constructor(depth) {
      this.rows = 6;
      this.columns = 7;
      this.depth = depth;
      this.score = 100000;
      this.round = 0;
      this.winners = [];
      this.turnsTaken = 0;

      this.init();
    }

    init() {
      const gameBoard = new Array(6);
      for (let i = 0; i < gameBoard.length; i++) {
        gameBoard[i] = new Array(7);

        for (let j = 0; j < gameBoard[i].length; j++) {
          gameBoard[i][j] = null;
        }
      }
      this.board = new Board(this, gameBoard, 0);
      Array.from(
        document.getElementById("gameBoard").getElementsByTagName("td")
      ).forEach((td) => {
        td.addEventListener(
          "click",
          (e) => {
            this.move(e);
          },
          false
        );
        td.addEventListener("mouseover", hoverOverCollumnHighLight);
        td.addEventListener("mouseleave", hoverOverCollumnHighLightReset);
      });
    }

    move(e) {
      if (!gameOver) {
        this.turnsTaken++;
        document.getElementById("uiBlocker").classList.add("block");
        const element = e.target || window.event.srcElement;
        if (this.round === 0) this.playCoin(element.cellIndex);
        document
          .getElementById("fc" + element.cellIndex)
          .classList.remove("bounce");
        window.sleep(800).then(() => {
          if (this.round === 1) this.generateComputerDecision();
        });
      }
    }

    static animateDrop({ inputRow, inputCol, moveTurn, currentRow = 0 } = {}) {
      if (currentRow === inputRow) {
        if (!gameOver && !moveTurn) {
          window.sleep(75).then(() => {
            window.modalOpen("Thinking...");
          });
          document
            .getElementsByTagName("html")[0]
            .classList.add("progressCursor");
        }
        if (moveTurn) {
          document.getElementById("uiBlocker").classList.remove("block");
          animationMode = false;
        }
        document.getElementById(
          "td" + currentRow + inputCol
        ).className = moveTurn ? "coin cpu-coin" : "coin human-coin";
        return;
      }
      animationMode = true;
      document
        .getElementById("td" + currentRow + inputCol)
        .classList.add("coin");
      document
        .getElementById("td" + currentRow + inputCol)
        .classList.add(moveTurn ? "cpu-coin" : "human-coin");
      window.sleep(100).then(() => {
        document
          .getElementById("td" + currentRow + inputCol)
          .classList.remove("coin");
        document
          .getElementById("td" + currentRow + inputCol)
          .classList.remove(moveTurn ? "cpu-coin" : "human-coin");
      });
      window.sleep(100).then(() => {
        Game.animateDrop({
          currentRow: currentRow + 1,
          inputCol,
          inputRow,
          moveTurn,
        });
      });
    }

    playCoin(column) {
      if (!gameOver) {
        for (let y = this.rows - 1; y >= 0; y--) {
          const td = document.getElementById("gameBoard").rows[y].cells[column];
          if (td.classList.contains("empty")) {
            if (this.round === 1) {
              Game.animateDrop({
                inputCol: column,
                inputRow: y,
                moveTurn: true,
              });
            } else {
              Game.animateDrop({
                inputCol: column,
                inputRow: y,
                moveTurn: false,
              });
            }
            break;
          }
        }
        if (!this.board.canPlace(column)) {
          document.getElementById("uiBlocker").classList.remove("block");
          window.modal("Invalid move!", 2000);
          return;
        }
        this.round = this.round === 0 ? 1 : 0;
        this.checkGameOver();
      }
    }

    quickMove() {
      for (let column = 0; column < this.columns; column++) {
        const newBoard = this.board.getBoardCopy();
        if (!newBoard.columnIsFull(column)) {
          newBoard.placeInColumnForQuickMove(column, 1);
          if (newBoard.evaluateScore() === 100000) {
            return column;
          }
        }
      }
      for (let column = 0; column < this.columns; column++) {
        const newBoard = this.board.getBoardCopy();
        if (!newBoard.columnIsFull(column)) {
          newBoard.placeInColumnForQuickMove(column, 0);
          if (newBoard.evaluateScore() === -100000) {
            return column;
          }
        }
      }
      return -1;
    }

    generateComputerDecision() {
      if (!gameOver) {
        let aiMove = 0;
        const quickMove = this.quickMove();
        if (quickMove !== -1) {
          aiMove = quickMove;
        } else {
          [aiMove] = this.maximize(this.board, this.getDepth());
        }
        window.sleep(325 * (14 / Number(this.getDepth()))).then(() => {
          window.modalClose();
          window.sleep(100).then(() => this.playCoin(aiMove));
        });
      }
    }

    getDepth() {
      if (Number(this.depth) <= 4) {
        return this.depth;
      } else if (this.turnsTaken < 5) {
        return this.depth - 2;
      } else {
        return this.depth;
      }
    }

    maximize(board, depth, alpha, beta) {
      const score = board.evaluateScore();
      if (board.isFinished(depth, score)) return [null, score];
      const max = [null, -99999];
      for (let column = 0; column < this.columns; column++) {
        const newBoard = board.getBoardCopy();
        if (newBoard.canPlace(column)) {
          const nextMove = this.minimize(newBoard, depth - 1, alpha, beta);
          if (max[0] === null || nextMove[1] > max[1]) {
            max[0] = column;
            [, max[1]] = nextMove;
            [, alpha] = nextMove;
          }
          if (alpha >= beta) return max;
        }
      }
      return max;
    }

    minimize(board, depth, alpha, beta) {
      const score = board.evaluateScore();
      if (board.isFinished(depth, score)) return [null, score];
      const min = [null, 99999];
      for (let column = 0; column < this.columns; column++) {
        const newBoard = board.getBoardCopy();
        if (newBoard.canPlace(column)) {
          const nextMove = this.maximize(newBoard, depth - 1, alpha, beta);
          if (min[0] === null || nextMove[1] < min[1]) {
            min[0] = column;
            [, min[1]] = nextMove;
            [, beta] = nextMove;
          }
          if (alpha >= beta) return min;
        }
      }
      return min;
    }

    checkGameOver() {
      const thisScore = this.board.evaluateScore();
      if (thisScore === -this.score) {
        this.gameOverHelper("You Win!");
      } else if (thisScore === this.score) {
        this.gameOverHelper("You Lose!");
      } else if (this.board.isFull()) {
        gameOver = true;
        window.modal("Draw!", 2000);
      }
      document
        .getElementsByTagName("html")[0]
        .classList.remove("progressCursor");
    }

    gameOverHelper(message) {
      document.getElementById("uiBlocker").classList.remove("block");
      gameOver = true;
      window.modal(message, 2000);
      window.sleep(1000).then(() => {
        this.winnersColorChange();
      });
    }

    winnersColorChange() {
      document.getElementById("gameBoard").className = "finished";
      for (let i = 0; i < this.winners.length; i++) {
        const name = document.getElementById("gameBoard").rows[
          this.winners[i][0]
        ].cells[this.winners[i][1]].className;
        document.getElementById("gameBoard").rows[this.winners[i][0]].cells[
          this.winners[i][1]
        ].className = name + " win";
      }
    }
  }

  function hoverOverCollumnHighLight(e) {
    if (!gameOver && !animationMode) {
      const col = Number(e.target.id.substring(3));
      document.getElementById("fc" + col).classList.add("bounce");
      for (let y = 5; y >= 0; y--) {
        if (
          document.getElementById("td" + y + col).classList.contains("empty")
        ) {
          document.getElementById("td" + y + col).classList.add("glow");
          break;
        }
      }
    }
  }

  function hoverOverCollumnHighLightReset(e) {
    const col = Number(e.target.id.substring(3));
    document.getElementById("fc" + col).classList.remove("bounce");
    for (let y = 5; y >= 0; y--) {
      if (document.getElementById("td" + y + col).classList.contains("empty")) {
        document.getElementById("td" + y + col).classList.remove("glow");
        break;
      }
    }
  }

  const start = () => {
    if (!gameStarted) {
      gameStarted = true;
      document.getElementById("difficulty").disabled = true;
      window.Game = new Game(
        Array.from(document.getElementById("difficulty").options).find(
          (d) => d.selected
        ).value
      );
    }
  };

  (() => {
    document.getElementById("start").addEventListener("click", start);

    for (let i = 0; i < 7; i++) {
      const circle = document.createElement("div");
      circle.id = "fc" + i;
      circle.classList.add("floatingCircle");
      document.getElementById("floatingCircles").appendChild(circle);
    }

    for (let i = 0; i < 6; i++) {
      const tableRow = document.createElement("tr");
      document.getElementById("gameBoard").appendChild(tableRow);
      for (let j = 0; j < 7; j++) {
        const tableData = document.createElement("td");
        tableData.className = "empty";
        tableData.id = "td" + i + j;
        tableRow.appendChild(tableData);
      }
    }
  })();
})();

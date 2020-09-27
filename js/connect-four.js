/*eslint-disable max-classes-per-file */
/*eslint-disable no-undef */
/*eslint-disable strict */
(() => {
	let gameStarted = false;
	let gameOver = false;

	class Board {
		constructor(game, field, player) {
			this.game = game;
			this.field = field;
			this.player = player;
		}

		isFinished(depth, score) {
			if (depth == 0 || score == this.game.score || score == -this.game.score || this.isFull()) {
				return true;
			}
			return false;
		}

		place(column) {
			if (this.field[0][column] === null && column >= 0 && column < this.game.columns) {

				for (let y = this.game.rows - 1; y >= 0; y--) {
					if (this.field[y][column] === null) {
						this.field[y][column] = this.player;
						break;
					}
				}
				this.player = this.game.switchRound(this.player);
				return true;
			} else {
				return false;
			}
		}

		scorePosition(row, column, deltaY, deltaX) {
			let humanPoints = 0;
			let computerPoints = 0;
			this.game.winningArrayHuman = [];
			this.game.winningArrayCpu = [];

			for (let i = 0; i < 4; i++) {
				if (this.field[row][column] == 0) {
					this.game.winningArrayHuman.push([row, column]);
					humanPoints++;
				} else if (this.field[row][column] == 1) {
					this.game.winningArrayCpu.push([row, column]);
					computerPoints++;
				}
				row = row + deltaY;
				column = column + deltaX;
			}
			if (humanPoints == 4) {
				this.game.winningArray = this.game.winningArrayHuman;
				return -this.game.score;
			} else if (computerPoints == 4) {
				this.game.winningArray = this.game.winningArrayCpu;
				return this.game.score;
			} else {
				return computerPoints;
			}
		}

		score() {
			let points = 0;
			let verticalPoints = 0;
			let horizontalPoints = 0;
			let diagonalPoints1 = 0;
			let diagonalPoints2 = 0;
			for (let row = 0; row < this.game.rows - 3; row++) {
				for (let column = 0; column < this.game.columns; column++) {
					const score = this.scorePosition(row, column, 1, 0);
					if (score == this.game.score) return this.game.score;
					if (score == -this.game.score) return -this.game.score;
					verticalPoints = verticalPoints + score;
				}
			}
			for (let row = 0; row < this.game.rows; row++) {
				for (let column = 0; column < this.game.columns - 3; column++) {
					const score = this.scorePosition(row, column, 0, 1);
					if (score == this.game.score) return this.game.score;
					if (score == -this.game.score) return -this.game.score;
					horizontalPoints = horizontalPoints + score;
				}
			}
			for (let row = 0; row < this.game.rows - 3; row++) {
				for (let column = 0; column < this.game.columns - 3; column++) {
					const score = this.scorePosition(row, column, 1, 1);
					if (score == this.game.score) return this.game.score;
					if (score == -this.game.score) return -this.game.score;
					diagonalPoints1 = diagonalPoints1 + score;
				}
			}
			for (let row = 3; row < this.game.rows; row++) {
				for (let column = 0; column <= this.game.columns - 4; column++) {
					const score = this.scorePosition(row, column, -1, +1);
					if (score == this.game.score) return this.game.score;
					if (score == -this.game.score) return -this.game.score;
					diagonalPoints2 = diagonalPoints2 + score;
				}
			}
			points = horizontalPoints + verticalPoints + diagonalPoints1 + diagonalPoints2;
			return points;
		}

		isFull() {
			for (let i = 0; i < this.game.columns; i++) {
				if (this.field[0][i] === null) {
					return false;
				}
			}
			return true;
		}

		copy() {
			const newBoard = [];
			for (let i = 0; i < this.field.length; i++) {
				newBoard.push(this.field[i].slice());
			}
			return new Board(this.game, newBoard, this.player);
		}
	}


	class Game {
		constructor(depth) {
			this.rows = 6;
			this.columns = 7;
			this.status = 0;
			this.depth = depth;
			this.score = 100000;
			this.round = 0;
			this.winningArray = [];
			this.iterations = 0;

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
			const td = document.getElementById("gameBoard").getElementsByTagName("td");
			for (let i = 0; i < td.length; i++) {
				if (td[i].addEventListener) {
					td[i].addEventListener("click", (e) => {
						this.act(e);
					}, false);
					td[i].addEventListener("mouseover", hoverOverCollumnHighLight);
					td[i].addEventListener("mouseleave", hoverOverCollumnHighLightReset);
				} else if (td[i].attachEvent) {
					td[i].attachEvent("click", this.act);
				}
			}
		}

		act(e) {
			if (gameStarted && !gameOver) {
				const element = e.target || window.event.srcElement;
				if (this.round == 0) this.place(element.cellIndex);
				if (this.round == 1) this.generateComputerDecision();
			}
		}

		static animateDrop({ inputRow, inputCol, moveTurn, currentRow = 0 } = {}) {
			if (currentRow === inputRow) return;
			document.getElementById("td" + currentRow + inputCol).classList.add("coin");
			document.getElementById("td" + currentRow + inputCol).classList.add(moveTurn ? "cpu-coin" : "human-coin");
			window.sleep(120).then(() => {
				document.getElementById("td" + currentRow + inputCol).classList.remove("coin");
				document.getElementById("td" + currentRow + inputCol).classList.remove(moveTurn ? "cpu-coin" : "human-coin");
			});
			window.sleep(125).then(() => {
				Game.animateDrop({
					"currentRow": currentRow + 1,
					inputCol,
					inputRow,
					moveTurn
				});
			});
		}

		place(column) {
			if (this.board.score() != this.score && this.board.score() != -this.score && !this.board.isFull()) {
				for (let y = this.rows - 1; y >= 0; y--) {
					if (document.getElementById("gameBoard").rows[y].cells[column].classList.contains("empty")) {
						if (this.round == 1) {
							Game.animateDrop({
								"inputCol": column,
								"inputRow": y,
								"moveTurn": true
							});
							window.sleep(y * 125).then(() => {
								document.getElementById("gameBoard").rows[y].cells[column].className = "coin cpu-coin";
							});
						} else {
							Game.animateDrop({
								"inputCol": column,
								"inputRow": y,
								"moveTurn": false
							});
							window.sleep(y * 125).then(() => {
								document.getElementById("gameBoard").rows[y].cells[column].className = "coin human-coin";
								if (!gameOver) {
									window.sleep(200).then(() => window.modalOpen("Thinking..."));
								}
							});
						}
						break;
					}
				}
				if (!this.board.place(column)) {
					return alert("Invalid move!");
				}
				this.round = this.switchRound(this.round);
				this.updateStatus();
			}
			return null;
		}

		generateComputerDecision() {
			if (this.board.score() != this.score && this.board.score() != -this.score && !this.board.isFull()) {
				this.iterations = 0;
				setTimeout(() => {
					const aiMove = this.maximizePlay(this.board, this.depth);
					window.sleep(700).then(() => {
						window.modalClose();
						window.sleep(300).then(() => this.place(aiMove[0]));
					});
				}, 800);
			}
		}

		maximizePlay(board, depth) {
			const score = board.score();
			if (board.isFinished(depth, score)) return [null, score];
			const max = [null, -99999];
			for (let column = 0; column < this.columns; column++) {
				const newBoard = board.copy();
				if (newBoard.place(column)) {
					this.iterations++;
					const nextMove = this.minimizePlay(newBoard, depth - 1);
					if (max[0] === null || nextMove[1] > max[1]) {
						max[0] = column;
						max[1] = nextMove[1];
					}
				}
			}
			return max;
		}

		minimizePlay(board, depth) {
			const score = board.score();
			if (board.isFinished(depth, score)) return [null, score];
			const min = [null, 99999];
			for (let column = 0; column < this.columns; column++) {
				const newBoard = board.copy();
				if (newBoard.place(column)) {
					this.iterations++;
					const nextMove = this.maximizePlay(newBoard, depth - 1);
					if (min[0] === null || nextMove[1] < min[1]) {
						min[0] = column;
						min[1] = nextMove[1];
					}
				}
			}
			return min;
		}

		switchRound(round) {
			return round == 0 ? 1 : 0;
		}

		updateStatus() {
			if (this.board.score() == -this.score) {
				gameOver = true;
				this.status = 1;
				window.modal("You Win!", 2000);
				window.sleep(1000).then(() => this.markWin());
			}
			if (this.board.score() == this.score) {
				gameOver = true;
				this.status = 2;
				window.modal("You Lose!", 2000);
				window.sleep(1000).then(() => this.markWin());
			}
			if (this.board.isFull()) {
				gameOver = true;
				this.status = 3;
				window.modal("Draw!", 2000);
			}
			const html = document.getElementById("status");
			if (this.status == 0) {
				html.className = "status-running";
				html.textContent = "running";
			} else if (this.status == 1) {
				html.className = "status-won";
				html.textContent = "won";
			} else if (this.status == 2) {
				html.className = "status-lost";
				html.textContent = "lost";
			} else {
				html.className = "status-tie";
				html.textContent = "tie";
			}
		}

		markWin() {
			document.getElementById("gameBoard").className = "finished";
			for (let i = 0; i < this.winningArray.length; i++) {
				const name = document.getElementById("gameBoard").rows[this.winningArray[i][0]].cells[this.winningArray[i][1]].className;
				document.getElementById("gameBoard").rows[this.winningArray[i][0]].cells[this.winningArray[i][1]].className = name + " win";
			}
		}
	}

	function hoverOverCollumnHighLight(e) {
		const col = Number(e.target.id.substring(3));
		document.getElementById("fc" + col).classList.add("bounce");
		for (let y = 5; y >= 0; y--) {
			if (document.getElementById("td" + y + col).classList.contains("empty")) {
				document.getElementById("td" + y + col).classList.add("glow");
				break;
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

	function start() {
		gameStarted = true;
		window.Game = new Game(document.getElementById("difficulty").options[difficulty.selectedIndex].value);
	}

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
			for (let j = 0; j < 7; j++) {
				const tableData = document.createElement("td");
				tableData.className = "empty";
				tableData.id = "td" + i + j;
				tableRow.appendChild(tableData);
			}
			document.getElementById("gameBoard").appendChild(tableRow);
		}
	})();
})();


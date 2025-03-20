# Connect Four

Connect Four is a classic strategy game implemented as a web game. In this project, you play against a computer opponent whose moves are determined using a MinMax algorithm enhanced with Alpha-Beta pruning. The difficulty settings determine how deep the computer searches the decision tree, allowing for an adjustable challenge ranging from "Easy" to "Very Hard."

---

## Key Features

• Classic Connect Four gameplay with intuitive click-and-drop mechanics  
• Responsive design with attractive animations and UI feedback  
• Adjustable difficulty levels which control the AI search depth  
• Computer opponent powered by a MinMax algorithm with Alpha-Beta pruning  
• Clean, modular code with separate JavaScript and CSS files  
• Public domain (Unlicense) license – free for any purpose

---

## Installation Instructions

1. **Clone the Repository**  
   Open your terminal and run:
   > git clone https://github.com/ShaneMarusczak/Connect-Four-MinMax.git

2. **Navigate to the Project Folder**  
   Change into the project directory:
   > cd Connect-Four-MinMax

3. **Open in Your Browser**  
   Simply open the `index.html` file in your preferred web browser. Since this is a front-end web project, no server-side installation or complex build step is required.  
   
   Alternatively, you can use a local development server (like Live Server for VS Code) to preview changes quickly.

---

## Usage Guide

1. **Launching the Game**  
   When you open the `index.html` file in your browser, you will see the Connect Four game interface with a header, difficulty selection, and game board.

2. **Select Difficulty**  
   Use the drop-down menu to choose one of the four difficulty levels:
   - Easy (search depth: low)
   - Medium (default)
   - Hard
   - Very Hard

3. **Start Game**  
   Click the "Start" button to begin. The game will disable the difficulty selection, and you can start playing your move against the computer.

4. **Making Moves**  
   • Hover over a column to see the animation highlighting how the coin will drop.  
   • Click on the desired column to place your coin.  
   • After your move, the computer’s turn will be executed based on the AI decision process.  
   • Animations show the coin "dropping" into the board.

5. **Restarting the Game**  
   Click the "Restart" button to reload the page and start a new game at any time.

6. **Visual Feedback**  
   Winning moves are highlighted with an animation, and a modal will display appropriate messages (e.g., "You Win!", "You Lose!", or "Draw!") automatically at game end.

---

## File and Structure Overview

• **index.html**  
  The primary HTML file that contains the game’s layout, including the header, game board, menu, and links to CSS and JavaScript files.

• **/css**  
  - *style.css*: The main CSS file for basic styles.  
  - *style.min.css*: The minified version for production use, containing animations, layout settings, and responsive design rules.

• **/js**  
  - *connect-four.js*: Unminified JavaScript source for the game logic including board setup, user interaction, and AI decision-making.  
  - *connect-four.min.js*: The minified version for production with similar functionality, optimized for performance.

• **/images**  
  Contains assets such as the home icon, GitHub icon, and various favicons (e.g., faviconred.ico, faviconyellow.ico) used in the UI.

• **.git Folder and Related Files**  
  Standard Git configuration and hook samples are included for version control and repository management.

---

## Configuration Details

• **Difficulty Settings:**  
 The difficulty is selected through a drop-down in the UI. This setting directly influences how deeply the AI scans in its MinMax decision-making process.

• **JavaScript Parameters:**  
 - Certain scripts use animation delays and timeouts (e.g., 600ms for move execution, 85ms for coin drop animation) to control the visual flow.  
 - The MinMax algorithm score (set to 100000) is used as a reference for win/loss evaluation.

• **CSS:**  
 • Responsive design rules are applied using media queries that adjust the layout for smaller screens.  
 • Animations such as “bounce,” “glow,” and coin drop effects are defined within both the minified and unminified CSS.

• **Git Configuration:**  
 Default Git files and hooks are present for contributors. See the Git configuration files for repository metadata.

---

## Contribution Guidelines

Contributions to the Connect Four project are welcome! If you’d like to suggest improvements, fix bugs, or add new features, please submit a pull request. For detailed instructions on how to contribute, refer to the [CONTRIBUTING.md](CONTRIBUTING.md) file if available.

Before submitting changes, ensure that your code adheres to the project’s style, and test your changes thoroughly.

---

## License Information

This project is released into the public domain under the [Unlicense](LICENSE.md). Feel free to copy, modify, publish, use, compile, sell, or distribute this software for any purpose without any restrictions.

For more information about the Unlicense, please visit <https://unlicense.org>.

---

## Additional Resources

• Project Repository:  
 <https://github.com/ShaneMarusczak/Connect-Four-MinMax>

• Home Page (for more games):  
 <https://marusczak.com/Games-Home-Page>

Enjoy the game and thanks for checking out Connect Four!

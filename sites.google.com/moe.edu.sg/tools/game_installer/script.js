function page1() {
    document.body.innerHTML = `<h1>game installer thingy</h1><br><p>click next to continue</p><br><button onclick="page2()">next</button>`;
}

function page2() {
    document.body.innerHTML = `
        <h1>Select a game</h1>
        <p>Select a game from the list and upload the install file for the game.</p>

        <select id="gameSelect">
            <option value="">Select a game...</option>
        </select>

        <br><br>

        <input type="file" id="gameFile" accept=".html,.htm">

        <br><br>

        <button id="installButton">Install Game</button>

        <p id="status"></p>
    `;

    const gameSelect = document.getElementById("gameSelect");
    const gameFile = document.getElementById("gameFile");
    const installButton = document.getElementById("installButton");
    const status = document.getElementById("status");

    fetch("/sites.google.com/moe.edu.sg/tools/game_installer/game_list.csv")
        .then(response => response.text())
        .then(csv => {
            const games = csv
                .split(/\r?\n/)
                .map(game => game.trim())
                .filter(game => game.length > 0);

            gameSelect.innerHTML = `<option value="">Select a game...</option>`;

            games.forEach(gameName => {
                const option = document.createElement("option");
                option.value = gameName;
                option.textContent = gameName;
                gameSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error(error);
        });

    const dbRequest = indexedDB.open("GameInstaller", 1);

    dbRequest.onupgradeneeded = function(event) {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("games")) {
            db.createObjectStore("games", {
                keyPath: "name"
            });
        }
    };

    installButton.addEventListener("click", function() {
        const selectedGame = gameSelect.value;
        const file = gameFile.files[0];

        if (!selectedGame || !file) {
            return;
        }

        const transaction = dbRequest.result.transaction(
            "games",
            "readwrite"
        );

        const store = transaction.objectStore("games");

        store.put({
            name: selectedGame,
            file: file,
            filename: file.name,
            installedAt: Date.now()
        });
    });
}
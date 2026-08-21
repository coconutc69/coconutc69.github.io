function page1() {
    document.body.innerHTML = `<h1>game installer thingy</h1><br><p>click next to continue</p><br><button onclick="page2()">next</button>`;
}

function page2() {
    document.body.innerHTML = `
        <h1>select a game</h1>
        <p>choose a game from the list of available games</p>

        <select id="gameSelect">
            <option value="">loading games...</option>
        </select>

        <br><br>

        <input type="file" id="gameFile" accept=".html,.htm">

        <br><br>

        <button id="installButton">install game</button>

        <p id="status"></p>
    `;

    const gameSelect = document.getElementById("gameSelect");
    const gameFile = document.getElementById("gameFile");
    const installButton = document.getElementById("installButton");
    const status = document.getElementById("status");

    // Load game list from CSV
    fetch("/sites.google.com/moe.edu.sg/tools/game_installer/game_list.csv")
        .then(response => {
            if (!response.ok) {
                throw new Error("could not load game_list.csv: failed to fetch");
            }

            return response.text();
        })
        .then(csv => {
            const lines = csv
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line !== "");

            gameSelect.innerHTML = `<option value="">select a game</option>`;

            for (let i = 1; i < lines.length; i++) {
                const gameName = lines[i];

                const option = document.createElement("option");
                option.value = gameName;
                option.textContent = gameName;

                gameSelect.appendChild(option);
            }
        })
        .catch(error => {
            console.error(error);
            gameSelect.innerHTML = `<option value="">failed to load games</option>`;
            status.textContent = "failed to load game list";
        });
    
    // indexeddb
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

        if (!selectedGame) {
            status.textContent = "select a game";
            return;
        }

        if (!file) {
            status.textContent = "select a html file";
            return;
        }

        if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) {
            status.textContent = "upload a html file buddy";
            return;
        }

        status.textContent = "installing...";

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

        transaction.oncomplete = function() {
            status.textContent = `"${selectedGame}" installed successfully!`;
        };

        transaction.onerror = function() {
            console.error(transaction.error);
            status.textContent = "failed to install game.";
        };
    });
}
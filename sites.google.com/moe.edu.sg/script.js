function tempdisabled() {
    document.body.innerHTML = `<h1>this function has been temporarily disabled or is not finished yet</h1>`;
}

function installGame() {
    // reminder to finish this and change the function for the button
    window.open(
        "https://coconutc69.github.io/sites.google.com/moe.edu.sg/tools/game_installer/index.html",
        "popup",
        "width=800,height=600,resizable=no,scrollbars=yes"
    )
}

function launch120game() {
    const request = indexedDB.open("GameInstaller", 1);

    request.onsuccess = function(event) {
        const db = event.target.result;
        const transaction = db.transaction("games", "readonly");
        const store = transaction.objectStore("games");
        const getRequest = store.get("eaglercraft 1.20");

        getRequest.onsuccess = async function() {
            const game = getRequest.result;

            if (!game) {
                return;
            }

            const popup = window.open(
                "about:blank",
                "popup",
                "width=800,height=600,resizable=no,scrollbars=yes"
            );

            if (!popup) {
                return;
            }

            const html = await game.file.text();

            popup.document.open();
            popup.document.write(html);
            popup.document.close();
        };
    };
}
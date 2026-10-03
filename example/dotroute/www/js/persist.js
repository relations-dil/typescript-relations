// Keeps the unum's data in a file next to the page, for single-file pages opened from disk.
//
//   unum.html      the page
//   data.js        every app's data: window.RELATIONS_DATA = { apps: { example: ..., ... } }
//
// A <script src> tag can load a sibling file from file:// where fetch can't, so opening the page
// loads the data on its own. localStorage is the working copy, one key per app (relations:<app>);
// the file is the saved one. Save writes the file - in place in Chromium after you pick it once
// (the File System Access API), as a download everywhere else - and leaving with changes the file
// doesn't have asks first. The whole store has one revision, not one per app.
//
// Loaded after the data file has, and before the apps start, so what the file holds is in
// localStorage by the time each LocalSource reads its key.

var Persist = (function () {

    var FORMAT = 2;
    var PREFIX = "relations:";
    var metaKey = "relations-persist:meta";
    var fileName = "data.js";
    var meta = {revision: 0, savedRevision: 0};
    var loaded = {};
    var handle = null;
    var chip = null;

    function read(name) {
        try {
            return JSON.parse(localStorage.getItem(name));
        } catch (error) {
            return null;
        }
    }

    function writeMeta() {
        localStorage.setItem(metaKey, JSON.stringify(meta));
    }

    function dirty() {
        return meta.revision > meta.savedRevision;
    }

    // Every app's payload in localStorage, by app name.
    function stored() {
        var apps = {};
        for (var index = 0; index < localStorage.length; index++) {
            var key = localStorage.key(index);
            if (key.indexOf(PREFIX) == 0) {
                apps[key.slice(PREFIX.length)] = read(key);
            }
        }
        return apps;
    }

    // What the file holds, as text. Apps that are in the file but aren't running here are kept.
    function contents() {
        return "window.RELATIONS_DATA = " + JSON.stringify({
            format: FORMAT,
            revision: meta.revision,
            saved: new Date().toISOString(),
            apps: Object.assign({}, loaded, stored())
        }, null, 1) + ";\n";
    }

    // Decide between what this browser has and what the file has. Revisions only ever go up, so:
    // the file is newer if it has revisions this browser never saved or loaded, and this browser
    // is ahead if it has revisions the file doesn't.
    function reconcile(file) {

        var local = Object.keys(stored()).length > 0;
        var saved = read(metaKey);

        // Data from before there was a file counts as one unsaved change.
        meta = saved || {revision: local ? 1 : 0, savedRevision: 0};

        var usable = file && file.format === FORMAT && file.apps;

        if (!usable) {
            return;
        }

        loaded = file.apps;

        var take = !local;

        if (!take && file.revision > meta.savedRevision) {
            take = !dirty() || confirm(
                "This browser has changes that aren't in the file, and the file has changes this " +
                "browser hasn't seen.\n\nOK uses the file (the browser's changes are lost).\n" +
                "Cancel keeps the browser's version."
            );
        }

        if (take) {
            for (var name in file.apps) {
                localStorage.setItem(PREFIX + name, JSON.stringify(file.apps[name]));
            }
            meta = {revision: file.revision, savedRevision: file.revision};
        } else if (file.revision < meta.savedRevision) {
            // The file is an older copy than the last save: what's here isn't in it.
            meta.savedRevision = file.revision;
        }

        writeMeta();

    }

    // ---------------------------------------------------------------- the remembered file

    function database() {
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open("relations-persist", 1);
            request.onupgradeneeded = function () {
                request.result.createObjectStore("handles");
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onerror = function () {
                reject(request.error);
            };
        });
    }

    function remembered(value) {
        return database().then(function (db) {
            return new Promise(function (resolve) {
                var store = db.transaction("handles", value ? "readwrite" : "readonly").objectStore("handles");
                var request = value ? store.put(value, fileName) : store.get(fileName);
                request.onsuccess = function () {
                    resolve(request.result);
                };
                request.onerror = function () {
                    resolve(null);
                };
            });
        }).catch(function () {
            return null;
        });
    }

    function pickable() {
        return typeof window.showSaveFilePicker === "function" && window.isSecureContext;
    }

    // The handle to write to: the remembered one if we may still use it, else ask for a file.
    // Must run inside the click that asked for the save, or the browser won't show anything.
    async function target() {

        handle = handle || await remembered();

        if (handle) {
            var options = {mode: "readwrite"};
            if (await handle.queryPermission(options) === "granted" || await handle.requestPermission(options) === "granted") {
                return handle;
            }
        }

        handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{description: "Relations data", accept: {"text/javascript": [".js"]}}]
        });

        await remembered(handle);

        return handle;

    }

    function download(text) {
        var link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    // ---------------------------------------------------------------- saving

    async function save() {

        var revision = meta.revision;
        var text = contents();

        try {
            if (pickable()) {
                var writable = await (await target()).createWritable();
                await writable.write(text);
                await writable.close();
            } else {
                download(text);
            }
        } catch (error) {
            // Closing the picker isn't a failure.
            if (error && error.name === "AbortError") {
                return false;
            }
            throw error;
        }

        meta.savedRevision = revision;
        writeMeta();
        show();

        return true;

    }

    // ---------------------------------------------------------------- showing it

    function show() {

        if (!chip) {
            return;
        }

        chip.className = "uk-position-fixed uk-position-bottom-right uk-margin uk-card uk-card-small uk-card-body uk-box-shadow-small " +
            (dirty() ? "uu-yellow" : "uu-green");
        chip.innerHTML = (dirty() ? "Unsaved changes" : "Saved") + " " +
            '<button type="button" class="uk-button uk-button-small uk-button-default">Save to ' +
            fileName + "</button>";
        chip.lastChild.onclick = function () {
            save().catch(function (error) {
                alert("Couldn't save: " + error.message);
            });
        };

    }

    // Called for each source as it starts: count every successful write, and show the state.
    function watch(source) {

        var saved = source.save.bind(source);

        source.save = function () {
            saved();
            meta.revision++;
            writeMeta();
            show();
        };

        if (chip) {
            return;
        }

        // Outside <body>: the app renders its views into body by replacing everything in it.
        chip = document.createElement("div");
        document.documentElement.appendChild(chip);
        show();

        window.addEventListener("beforeunload", function (event) {
            if (dirty()) {
                event.preventDefault();
                event.returnValue = "";
            }
        });

        document.addEventListener("keydown", function (event) {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                event.preventDefault();
                save();
            }
        });

    }

    reconcile(window.RELATIONS_DATA);

    return {watch: watch, save: save, dirty: dirty, fileName: fileName, meta: function () { return meta; }};

})();

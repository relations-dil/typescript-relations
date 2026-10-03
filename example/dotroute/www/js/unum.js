// The host: turns the list of apps in app.js into a running unum.
//
// For each app it gets the models (a models file registers a factory with Models.add), makes the
// app's source, seeds an empty one, and puts the models behind the access function. Models from
// different apps share one set of screens, addressed as /<app>/<model>.

var Models = {
    factories: {},
    add: function(name, factory) {
        Models.factories[name] = factory;
    }
};

var Unum = {

    // Load a models file with a script tag: it works from file:// where fetching a file doesn't.
    load: function(path) {
        return new Promise(function(resolve, reject) {
            var script = document.createElement("script");
            script.src = path;
            script.onload = resolve;
            script.onerror = function() {
                reject(new Error("can't load " + path));
            };
            document.head.appendChild(script);
        });
    },

    // The app's source, and whether it has never held anything (so it should be seeded).
    source: function(app) {

        if (app.source == "local") {
            var key = "relations:" + app.name;
            var fresh = localStorage.getItem(key) === null;
            var local = new Relations.LocalSource(app.name, {key: key});
            if (typeof Persist !== "undefined") {
                Persist.watch(local);
            }
            return fresh;
        }

        if (app.source == "mock") {
            new Relations.MockSource(app.name);
            return true;
        }

        throw new Error(app.name + ": unknown source '" + app.source + "'");

    },

    start: async function(apps) {

        var running = {};

        for (var app of apps) {

            if (!Models.factories[app.name]) {
                await Unum.load(app.models);
            }

            var models = Models.factories[app.name](Relations);
            var fresh = Unum.source(app);

            running[app.name] = models;

            if (fresh && app.seed) {
                await app.seed(models);
            }

        }

        DRApp.rest = DRApp.local(running);

        DRApp.models = (await DRApp.rest("GET", "api/model"))["models"];

        DRApp.models.forEach(function(model) {
            model.key = model.app + "_" + model.singular;
        });

        // What the nav and home page list: each app, with its models.
        DRApp.apps = apps.map(function(app) {
            return {
                name: app.name,
                title: app.title,
                models: DRApp.models.filter(function(model) {
                    return model.app == app.name;
                })
            };
        });

        DRApp.route("home", "/", "Home", "Base", "home");

        DRApp.apps.forEach(function(app) {
            DRApp.controller(app.name, "Base", {
                app: app,
                home: function() {
                    this.it = {app: this.app};
                    DRApp.render(this.it);
                }
            });
            DRApp.route(app.name + "_home", "/" + app.name, "App", app.name, "home");
        });

        DRApp.attach();

        DRApp.start();

        DRApp.refresh();

    }

};

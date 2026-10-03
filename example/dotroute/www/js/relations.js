// wait = true: don't route until service.js has fetched the models.
window.DRApp = new DoTRoute.Application(null, null, true);

DRApp.load = function (name) {
    return $.ajax({url: name + ".html", async: false}).responseText;
}

DRApp.format = function(value, format, titles) {
    if (titles && titles[value]) {
        value = titles[value];
    }
    if (Array.isArray(value)) {
        if (format) {
            var formatted = [];
            for (var index = 0; index < value.length; index++) {
                formatted.push(DRApp.format(value[index], format[index]));
            }
            return formatted.join(' - ');
        } else {
            return value.join(" ")
        }
    }
    if (format == "datetime") {
        return new Date(value*1000).toLocaleString();
    }
    return value == null ? '' : value;
}

DRApp.get = function(values, path) {

    if (typeof path === 'string' || path instanceof String) {
        path = path.split('__');
    }

    for (var index = 0; index < path.length; index++) {

        place = path[index];

        if (place.match(/^-?\d+$/)) {
            if (values == null) {
                values = [];
            }
            place = parseInt(place);
        } else {
            if (values == null) {
                values = {};
            }
            if (place[0] == '_') {
                place = place.slice(1);
            }
        }

        if (index < path.length - 1) {

            var next = path[index+1].match(/^-?\d+$/) ? [] : {};

            if (!Array.isArray(values)) {
                values = values[place] || next;
            } else if ((place > -1 ? place : Math.abs(place + 1)) > values.length - 1 || values[place] == null) {
                values = next;
            } else {
                values = values[place];
            }

        }

    }

    return values[place];

}

// doTRoute wires each route to its controller action with jQuery's $.proxy, and the jQuery these
// apps carry (1.x) doesn't know a native async function is a function. This hands it an ordinary
// function that returns the action's promise, so actions can await the data.
DRApp.async = function(work) {
    return function() {
        return work.apply(this, arguments);
    };
};

DRApp.controller("Base", null, {
    home: function() {
        DRApp.render(this.it);
    }
});

DRApp.controller("Model", "Base", {
    model: null,
    url: function(params) {
        if (params && Object.keys(params).length) {
            return "api/" + this.model.singular + "?" + $.param(params);
        } else {
            return "api/" + this.model.singular;
        }
    },
    id_url: function() {
        return this.url() + "/" + DRApp.current.path.id;
    },
    route: function(action, id) {
        if (id) {
            DRApp.go(this.model.singular + "_" + action, id);
        } else {
            DRApp.go(this.model.singular + "_" + action);
        }
    },
    list: DRApp.async(async function() {
        this.it = await DRApp.rest("GET", this.url());
        this.it.like = '';
        DRApp.render(this.it);
    }),
    like: function(event) {
        if (event.keyCode == 10 || event.keyCode == 13) {
            event.preventDefault();
            this.search();
        }
    },
    search: DRApp.async(async function() {
        this.it.like = $("#like").val();
        if (this.it.like) {
            this.it = await DRApp.rest("GET", this.url() + "?like=" + this.it.like);
            DRApp.render(this.it);
        } else {
            this.list();
        }
    }),
    fields_input: function() {
        var input = {};
        input[this.model.singular] = {}
        input["likes"] = {}
        for (var index = 0; index < this.it.fields.length; index++) {
            var field = this.it.fields[index];
            var value;
            if (field.readonly) {
                continue
            } else if ($('input[name=' + field.name + ']').length) {
                if (field.kind == "set") {
                    value = $('input[name=' + field.name + ']:checked').map(function() {return $(this).val(); }).get();
                } else {
                    value = $('input[name=' + field.name + ']:checked').val();
                }
            } else if (field.init) {
                value = {};
                var inits = Object.values(field.init);
                for (var init = 0; init < inits.length; init++) {
                    var attr = $('#' + field.name + '__' + inits[init]).val();
                    if (attr != '') {
                        value[inits[init]] = attr;
                    }
                }
            } else if (field.kind == "set") {
                value = $('#' + field.name).val().split(/ +/);
            } else if (field.kind == "bool") {
                value = $('#' + field.name).prop('checked');
            } else {
                value = $('#' + field.name).val();
            }
            if ($('#' + field.name + '__like').length) {
                input["likes"][field.name] = $('#' + field.name + '__like').val();
            }
            if (value && (value.length || field.init)) {
                if (field.options) {
                    for (var option = 0; option < field.options.length; option++) {
                        if (Array.isArray(value)) {
                            for (var val = 0; val < value.length; val++) {
                                if (value[val] == field.options[option]) {
                                    value[val] = field.options[option];
                                }
                            }
                        } else {
                            if (value == field.options[option]) {
                                value = field.options[option];
                            }
                        }
                    }
                } else if (field.kind == "list" || field.kind == "dict") {
                    value = JSON.parse(value);
                } else if (field.kind == "int") {
                    value = Math.round(value);
                }
                if (!field.init || Object.keys(value).length) {
                    input[this.model.singular][field.name] = value;
                }
            } else if (field.kind == "bool") {
                input[this.model.singular][field.name] = value;
            } else if (field.kind == "set" || field.kind == "list") {
                input[this.model.singular][field.name] = [];
            } else if (field.kind == "dict") {
                input[this.model.singular][field.name] = {};
            }
        }
        return input;
    },
    fields_change: DRApp.async(async function() {
        var url = DRApp.current.path.id ? this.id_url() : this.url();
        this.it = await DRApp.rest("OPTIONS", url, this.fields_input());
        DRApp.render(this.it);
    }),
    create: DRApp.async(async function() {
        this.it = await DRApp.rest("OPTIONS", this.url());
        DRApp.render(this.it);
    }),
    create_save: DRApp.async(async function() {
        var input = this.fields_input();
        this.it = await DRApp.rest("OPTIONS", this.url(), input);
        if (this.it.errors.length) {
            DRApp.render(this.it);
        } else {
            var model = (await DRApp.rest("POST", this.url(), input))[this.model.singular];
            if (this.model.id) {
                this.route("retrieve", model[this.model.id])
            } else {
                this.route("list");
            }
        }
    }),
    retrieve: DRApp.async(async function() {
        this.it = await DRApp.rest("OPTIONS", this.id_url());
        DRApp.render(this.it);
    }),
    update: DRApp.async(async function() {
        this.it = await DRApp.rest("OPTIONS", this.id_url());
        DRApp.render(this.it);
    }),
    update_save: DRApp.async(async function() {
        var input = this.fields_input();
        this.it = await DRApp.rest("OPTIONS", this.id_url(), input);
        if (this.it.errors.length) {
            DRApp.render(this.it);
        } else {
            await DRApp.rest("PATCH", this.id_url(), input);
            this.route("retrieve", DRApp.current.path.id);
        }
    }),
    delete: DRApp.async(async function() {
        if (confirm("Are you sure?")) {
            await DRApp.rest("DELETE", this.id_url());
            this.route("list");
        }
    })
});

DRApp.partial("Header", DRApp.load("header"));
DRApp.partial("Form", DRApp.load("form"));
DRApp.partial("Footer", DRApp.load("footer"));

DRApp.template("Home", DRApp.load("home"), null, DRApp.partials);
DRApp.template("Fields", DRApp.load("fields"), null, DRApp.partials);
DRApp.template("List", DRApp.load("list"), null, DRApp.partials);
DRApp.template("Create", DRApp.load("create"), null, DRApp.partials);
DRApp.template("Retrieve", DRApp.load("retrieve"), null, DRApp.partials);
DRApp.template("Update", DRApp.load("update"), null, DRApp.partials);

DRApp.model = function(model) {

    DRApp.controller(model.title, "Model", {
        model: model
    });

    DRApp.route(model.singular + "_list", "/" + model.singular, "List", model.title, "list");
    DRApp.route(model.singular + "_create", "/" + model.singular + "/create", "Create", model.title, "create");

    if (model.id) {
        DRApp.route(model.singular + "_retrieve", "/" + model.singular + "/{id:^\\d+$}", "Retrieve", model.title, "retrieve");
        DRApp.route(model.singular + "_update", "/" + model.singular + "/{id:^\\d+$}/update", "Update", model.title, "update");
    }

};

DRApp.attach = function() {

    for (var model = 0; model < DRApp.models.length; model++) {
        if (!DRApp.controllers[DRApp.models[model].name]) {
            DRApp.model(DRApp.models[model]);
        }
    }

};

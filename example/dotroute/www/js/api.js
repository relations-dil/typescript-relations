// The access function: DRApp.rest(type, url, data) is the only way the app touches its data.
//
// Two implementations, and the app can't tell them apart:
//
//   DRApp.http   - what the other apps use: a request to a relations-restx API.
//   DRApp.local  - the same API, answered from relations models running in this page.
//
// local speaks the restx contract exactly - the same endpoints, request bodies, response
// shapes and status codes (see python-relations-restx, resource.py) - so moving from the
// in-page mock to a real backend is changing which function service.js assigns to DRApp.rest.
// Nothing else changes: not the controllers, not the templates.

// ---------------------------------------------------------------- http

DRApp.http = async function(type, url, data) {
    var response = $.ajax({
        type: type,
        url: url,
        data: data ? JSON.stringify(data) : (type != 'GET' ? '{}' : null),
        contentType: type != 'GET' ? "application/json" : null,
        dataType: "json",
        async: false
    });
    if ((response.status != 200) && (response.status != 201) && (response.status != 202)) {
        alert(type + ": " + url + " failed\n" + JSON.stringify(response.responseJSON, null, 2));
        throw (type + ": " + url + " failed");
    }
    return response.responseJSON;
};

// ---------------------------------------------------------------- local

// apps is { <app>: { <model>: Class, ... }, ... }. Each app's models are addressed as
// api/<app>/<model>, so two apps can each have a model of the same name.
DRApp.local = function(apps) {

    var resources = {};

    Object.keys(apps).forEach(function(app) {
        Object.values(apps[app]).forEach(function(cls) {
            var thy = cls.thy();
            resources[app + "/" + thy.NAME] = {
                app: app,
                cls: cls,
                thy: thy,
                singular: thy.NAME,
                plural: thy.NAME + 's',
                endpoint: app + "/" + thy.NAME
            };
        });
    });

    // What goes over the wire is JSON: sets become sorted lists, nothing is shared by reference.
    function wire(value) {
        return JSON.parse(JSON.stringify(value, function(key, item) {
            if (item instanceof Set) {
                return Array.from(item).sort();
            }
            if (item instanceof Map) {
                return Object.fromEntries(item);
            }
            return item;
        }));
    }

    // A request that's wrong, as opposed to one that fails.
    function BadRequest(message) {
        this.message = message;
    }

    function criteria(params, data) {
        var found = {};
        params.forEach(function(value, name) {
            if (name.indexOf("limit") != 0 && name != "sort" && name != "count") {
                found[name] = value;
            }
        });
        return Object.assign(found, (data || {}).filter);
    }

    function verified(params, data) {
        if (!Array.from(params).length && !("filter" in (data || {}))) {
            throw new BadRequest("to confirm all, send a blank filter {}");
        }
        return criteria(params, data);
    }

    function many(resource, found) {
        return Object.keys(found).length ? resource.cls.many(found) : resource.cls.many();
    }

    // The base field definitions, as the Resource builds them from the model.
    function base(resource) {
        var titles = resource.thy._titles;
        return resource.thy.define().fields.map(function(field) {
            var form = {name: field.name, kind: field.kind};
            ["options", "validation", "init", "inject"].forEach(function(attribute) {
                var value = field[attribute];
                if (value && (!Array.isArray(value) || value.length)) {
                    form[attribute] = value;
                }
            });
            if (field.auto) {
                form.readonly = true;
            }
            if (field.default != null) {
                form.default = field.default;
            } else if (!field.auto && (!field.none || titles.indexOf(field.name) > -1)) {
                form.required = true;
            }
            return form;
        });
    }

    // OPTIONS: the fields for a form, with values, originals, and a parent's titles as options.
    async function fields(resource, likes, values, originals) {
        var out = [];
        for (var form of base(resource)) {
            var field = Object.assign({}, form);
            if (values && values[field.name] != null) {
                field.value = values[field.name];
            }
            if (originals && originals[field.name] != null) {
                field.original = originals[field.name];
            }
            var relation = resource.thy._ancestor(field.name);
            if (relation !== null) {
                var like = likes && field.name in likes ? {like: likes[field.name]} : null;
                var parent = like ? relation.Parent.many(like).limit() : relation.Parent.many().limit();
                var titles = await parent.titles();
                field.format = titles.format;
                field.overflow = parent.overflow;
                var value = field.value != null ? field.value : field.original;
                if (!like && value != null && !titles.has(value)) {
                    titles = await relation.Parent.one({[relation.parentId]: value}).titles();
                    field.overflow = true;
                }
                field.options = titles.ids;
                field.titles = titles.titles;
                Object.assign(field, like || {});
            }
            out.push(field);
        }
        return out;
    }

    // Titles of each parent a record or records point at, so keys can be shown by name.
    async function formats(resource, model) {
        var found = {};
        for (var field of resource.thy.define().fields) {
            var relation = resource.thy._ancestor(field.name);
            if (relation !== null) {
                var titles = await relation.Parent.many({[relation.parentId + "__in"]: [].concat(model[field.name])}).titles();
                found[field.name] = {titles: titles.titles, format: titles.format};
            }
        }
        return found;
    }

    async function respond(type, url, data) {

        var parts = url.split("?");
        var params = new URLSearchParams(parts[1] || "");
        var path = parts[0].replace(/^\/?api\//, "").split("/");

        if (path[0] == "model") {
            return [200, {models: Object.values(resources).map(function(resource) {
                return {
                    app: resource.app,
                    endpoint: resource.endpoint,
                    id: resource.thy._id,
                    titles: resource.thy._titles,
                    title: resource.thy.TITLE || resource.thy.define().title || resource.singular.charAt(0).toUpperCase() + resource.singular.slice(1),
                    singular: resource.singular,
                    plural: resource.plural,
                    list: resource.thy._list
                };
            })}];
        }

        var resource = resources[path[0] + "/" + path[1]];
        var id = path.length > 2 ? path[2] : null;
        var json = data || {};

        if (!resource) {
            return [404, {message: "unknown model " + path.slice(0, 2).join("/")}];
        }

        var lookup = function() {
            return resource.cls.one({[resource.thy._id]: id});
        };

        if (type == "OPTIONS") {
            var values = json[resource.singular];
            var likes = json.likes || {};
            if (id === null) {
                return [200, {fields: await fields(resource, likes, values), errors: []}];
            }
            var originals = (await lookup().retrieve()).export();
            return [200, {fields: await fields(resource, likes, values, originals), errors: []}];
        }

        if (type == "POST") {
            if ("filter" in json) {
                return respond("GET", url, data);
            }
            if (resource.singular in json) {
                var one = await new resource.cls(json[resource.singular]).create();
                return [201, {[resource.singular]: one.export()}];
            }
            if (resource.plural in json) {
                var several = await new resource.cls(json[resource.plural]).create();
                return [201, {[resource.plural]: several.export()}];
            }
            throw new BadRequest("either " + resource.singular + " or " + resource.plural + " required");
        }

        if (type == "GET") {
            if (id !== null) {
                var model = await lookup().retrieve();
                return [200, {[resource.singular]: model.export(), formats: await formats(resource, model)}];
            }
            var models = many(resource, criteria(params, json));
            if (params.has("sort")) {
                models = models.sort(...params.get("sort").split(","));
            }
            models = models.limit();
            if (params.has("count") && !["0", "no", "false"].includes(params.get("count").toLowerCase())) {
                return [200, {[resource.plural]: await models.count(), overflow: models.overflow}];
            }
            await models.retrieve();
            return [200, {[resource.plural]: models.export(), overflow: models.overflow, formats: await formats(resource, models)}];
        }

        if (type == "PATCH") {
            if (!(resource.singular in json) && !(resource.plural in json)) {
                throw new BadRequest("either " + resource.singular + " or " + resource.plural + " required");
            }
            var changing = id !== null ? lookup() : many(resource, verified(params, json));
            var changes = json[resource.singular] || json[resource.plural];
            await changing.retrieve();
            Object.keys(changes).forEach(function(name) {
                changing[name] = changes[name];
            });
            return [202, {updated: await changing.update()}];
        }

        if (type == "DELETE") {
            var removing = id !== null ? lookup() : many(resource, verified(params, json));
            return [202, {deleted: await removing.delete()}];
        }

        return [405, {message: type + " not allowed"}];

    }

    // The same handling the Resource gives every endpoint: bad requests are 400, a record that
    // isn't there is 404, anything else is 500, and each carries a message.
    return async function(type, url, data) {

        var status, body;

        try {
            [status, body] = await respond(type, url, data);
        } catch (error) {
            if (error instanceof BadRequest) {
                status = 400;
            } else {
                status = String(error.message).indexOf("none retrieved") > -1 ? 404 : 500;
            }
            body = {message: error.message};
        }

        // Exactly what DRApp.http does with the response.
        if ((status != 200) && (status != 201) && (status != 202)) {
            alert(type + ": " + url + " failed\n" + JSON.stringify(body, null, 2));
            throw (type + ": " + url + " failed");
        }

        return wire(body);

    };

};

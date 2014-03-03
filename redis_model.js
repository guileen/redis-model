// base redis model
//
// MaxID:
// _meta:foo id                id sequence
//
// Hash object:
// foo:id  hash                object
//
// Index field(sort by int field):
// ### model.index(fieldname)
// foo+indexfield              e.g. zadd foo+create_at foo.create_at foo.id
// model.list_by_field 
//
// Typed field:
// ### model.type(fieldname, type)
// ### model.retrival()  // retrival field value of type
//
// One to one:
// ### model.unique(fieldname, type)
// foo#email:email
// user.unique('email')
// user.get_by_email(email)
//
// Many to one:
// ### model.many_to_one(fieldname)
// foo.many_to_one(author, user)
// foo.list_by_author
// foo|author:name             e.g. zadd `foo#author: + foo.author`  Date.now() foo.id
//
// Many to many:
// e.g. comment with {id: id, foo:fid, bar:bid}
// ### model.m2m(fieldname1, fieldname2)
// comment/bar|foo:fid
// comment/foo|bar:bid
//
// Blob:
// store in others DB
// ### model.blob(fieldname, {
//      get: function(id, callback) {
//      }
//    , set: function(id, blob, callback) {
//      }
//    , del: function(id, callback) {
//      }
// })
//
// foo.blob('text', leveldb_blob('foo'))
var _ = require('dash5');
var async = require('async');
var all_models = {};

var redisStorage = function(redis) {
    return {
        get: function(model_name, id, callback) {
            redis.hgetall(model_name + ':' + id, callback);
        }
      , set: function(model_name, id, data, callback) {
            redis.hmset(model_name + ':' + id, data, callback);
        }
      , del: function(model_name, id, callback) {
            redis.del(model_name + ':' + id, callback);
        }
      , exists: function(model_name, id, callback) {
            redis.exists(model_name + ':' + id, callback);
        }
    }
}

var redisIdFactory = function(redis) {
    return function(model_name, callback) {
        redis.incr('_meta:' + model_name, callback);
    }
}

function toScore(value) {
    if(value instanceof Date) {
        return value.getTime();
    }
    return Number(value) || 0;
}

function RedisModel(model_name, _redis, idFactory, entityStore) {
    var redis = _redis;
    var model_fields = [];
    var field_types = {};
    var index_fields = []; // sort by int fields
    var unique_fields = []; // one to one fields
    var many_to_one_fields = []; // many to one fields

    idFactory = idFactory || redisIdFactory(redis);
    entityStore = entityStore || redisStorage(redis);

    function convert(data) {
        // TODO convert should clono data, else data will be change after save.
        _.each(field_types, function(type, field) {
                switch(type) {
                  case Date:
                    if(data[field] instanceof Date)
                        data[field] = data[field].toISOString();
                    break;
                  case Number:
                    break;
                  default:
                    // model fields to field_id
                    if(data[field]) {
                        delete data[field];
                    }
                }
        });
        return data;
    }

    function revert(data) {
        _.each(field_types, function(field, type) {
                switch(type) {
                  case Number:
                    data[field] = Number(data[field]);
                    break;
                  case Date:
                    data[field] = new Date(data[field]);
                    break;
                  default:
                    // model fields
                }
        })
        return data;
    }

    function listIdByScore(key, rev, suffix, offset, limit, min, max, callback) {
        if(!callback) {
            if(typeof max == 'function') {
                callback = max;
                max = null;
            } else if(typeof min == 'function') {
                callback = min;
                min = null;
            }
        }
        if(min || max) {
            if(!max) max = '+inf';
            if(!min) min = '-inf';
            redis[rev ? 'zrevrangebyscore' : 'zrangebyscore'](key + suffix, min, max, 'LIMIT', offset, limit, callback);
        } else {
            redis[rev ? 'zrevrange' : 'zrange'](key + suffix, offset, offset + limit, callback);
        }
    }

    function listByScore(key, rev, suffix, offset, limit, min, max, callback) {
        if(!callback) {
            if(typeof max == 'function') {
                callback = max;
                max = null;
            } else if(typeof min == 'function') {
                callback = min;
                min = null;
            }
        }
        listIdByScore(key, rev, suffix, offset, limit, min, max, function(err, listId) {
                async.map(listId, model.get, callback);
        })
    }
    function listFullByScore(key, rev, suffix, offset, limit, min, max, callback) {
        if(!callback) {
            if(typeof max == 'function') {
                callback = max;
                max = null;
            } else if(typeof min == 'function') {
                callback = min;
                min = null;
            }
        }
        listIdByScore(key, rev, suffix, offset, limit, min, max, function(err, listId) {
                async.map(listId, model.get_full, callback);
        })
    }
    var model = all_models[model_name] = {
        // define
        type: function(field, type) {
            if(typeof type == 'string') {
                model_fields.push([field, type]);
            }
            field_types[field] = type;
            return model;
        }
      , index: function(field) {
            index_fields.push(field);
            var list_key = model_name + '+' + field;
            model['id_of_' + field] = listIdByScore.bind(list_key, false, '');
            model['rid_of_' + field] = listIdByScore.bind(list_key, 'reverse', '');
            model['list_of_' + field] = listByScore.bind(list_key, false, '');
            model['rlist_of_' + field] = listByScore.bind(list_key, 'reverse', '');
            model['full_of_' + field] = listFullByScore.bind(list_key, false, '');
            model['rfull_of_' + field] = listFullByScore.bind(list_key, 'reverse', '');
            return model;
        }
      , unique: function(field) {
            unique_fields.push(field);
            model['get_by_' + field] = function(value, callback) {
                redis.get(model_name + '#' + field + ':' + value, function(err, id) {
                        if(err) return callback(err);
                        model.get(id, callback);
                })
            }
            model['get_full_by_' + field] = function(value, callback) {
                redis.get(model_name + '#' + field + ':' + value, function(err, id) {
                        if(err) return callback(err);
                        model.get_full(id, callback);
                })
            }
            return model;
        }
      , many_to_one: function(field, type) {
            type && model.type(field, type);
            type = field_types[field];
            many_to_one_fields.push(field);
            if(!type) throw new Error('many_to_one ' + field + ' require type');
            var list_prefix = model_name + '|' + field + ':';
            model['id_of_' + field] = listIdByScore.bind(list_prefix, false);
            model['rid_of_' + field] = listIdByScore.bind(list_prefix, 'reverse');
            model['list_of_' + field] = listByScore.bind(list_prefix, false);
            model['rlist_of_' + field] = listByScore.bind(list_prefix, 'reverse');
            model['full_of_' + field] = listFullByScore.bind(list_prefix, false);
            model['rfull_of_' + field] = listFullByScore.bind(list_prefix, 'reverse');
            return model;
        }
      , many_to_many: function(field1, field2) {
            var type1 = field_types[field1];
            var type2 = field_types[field2];
            var model1 = all_models[type1];
            var model2 = all_models[type2];
            if(!model1 || !model2) throw new Error('many_to_many require type ' + [model_name, field1, field2].join(','));
            many_to_many_fields.push([field1, field2]);
            // user comment post
            // post.list_comment_user
            // user.list_comment_post
            // TODO handle save, handle find
            var prefix1 = model_name + '/' + field2 + '|' + field1 + ':';
            model1['list_' + model_name + '_' + field2] = listIdByScore.bind()
            return model;
        }
        // creaet, update, save
      , _save: function(data, callback) {
            var multi = redis.multi();
            _.each(index_fields, function(field) {
                    multi.zadd(model_name + '+' + field, toScore(data[field]), data.id);
            });
            _.each(unique_fields, function(field) {
                    multi.set(model_name + '#' + field + ':' + data[field], data.id);
            });
            _.each(many_to_one_fields, function(field) {
                    multi.zadd(model_name + '|' + field + ':' + data[field], Date.now(), data.id);
            });
            multi.exec(function(err) {
                    if(err) throw err;
            });
            entityStore.set(model_name, data.id, convert(data), callback);
        }
      , insert: function(data, callback) {
            console.log('insert', data);
            if(data.id) throw new Error('model id already exists')
            idFactory(model_name, function(err, id) {
                    console.log('id', id);
                    if(err) return callback(err);
                    entityStore.exists(model_name, id, function(err, exists) {
                            if(err) return callback(err);
                            // insert again if exists
                            if(exists) return model.insert(data, callback);
                            data.id = id;
                            data.create_at = new Date();
                            model._save(data, function(err, results) {
                                    callback(err, data);
                            });
                    });
            })
        }
      , update: function(data, callback) {
            data.update_at = new Date();
            model._save(data, function(err, results) {
                    callback(err, data);
            });
        }
      , save: function(data, callback) {
            console.log('save', data);
            if(data.id) {
                model.update(data, callback);
            } else {
                model.insert(data, callback);
            }
        }
      , remove: function(id, callback) {
            redis.del(model.key(id), callback);
        }
        // find
      , get: function (id, callback) {
            entityStore.get(model_name, id, _.fapply(callback, revert));
        }
      , get_full: function (id, callback) {
            this.get(id, function(err, data) {
                    // TODO remove async, use dash5
                    async.map(model_fields, function(fieldAndType, emit) {
                            // model
                            var field_id = data[fieldAndType[0] + '_id'];
                            var field_model = all_models[fieldAndType[1]];
                            field_id && field_model ? field_model.get(field_id, emit) : emit();
                        }, function(err, results) {
                            _.each(model_fields, function(fieldAndType, i) {
                                    data[fieldAndType[0]] = results[i];
                            })
                            callback(err, data);
                    });
            });
        }
        // list
    };
    // default fields
    model
      .type('create_at', Date)
      .type('update_at', Date)
      ;
    return model;
}

RedisModel.getModel = function(model_name) {
    return all_models[model_name];
}

var exports = module.exports = RedisModel;

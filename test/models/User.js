var config = require('../config');
var redisit = require('../../');

var User = redisit('user', {
        entityStore: redisit.entityStore
      , redis: require('redis').createClient()
      , fields: {
            id: {
                'default': function() {

                }
            }
          , username: {
                required: true
              , len: [4, 15]
              , unique: true
            }
          , email: {
                type: 'email'
              , require: true
              , unique: true
            }
          , password: {
                required: true
              , verify: function(value) {
                }
            }
          , avatar: {
                'default': 'foo/empty.png'
            }
          , invitor: {
                type: 'model'
              , model: 'user'
              , reverse: null // null, 'set', 'zset', 'list'
              // , many_to_one: 'user' // save sorted set
            }
        }
      , indices: [
            'create_at'
        ]
});

var exports = module.exports = User;

// User.on('insert', function(user) {

// })

// User.on('update', function(user) {

// })

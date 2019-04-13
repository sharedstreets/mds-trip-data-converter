const turf = require("@turf/turf");
const queue = require("d3-queue").queue;
const h3 = require("h3-js");
const moment = require("moment");
const request = require("request");
const shst = require("sharedstreets");

graphOpts = {
  source: "osm/planet-181224",
  tileHierarchy: 6
};
var graph = new shst.Graph(
  {
    type: "Polygon",
    coordinates: [
      [
        [-83.17680358886719, 42.313369811689746],
        [-82.99072265625, 42.313369811689746],
        [-82.99072265625, 42.416359972082866],
        [-83.17680358886719, 42.416359972082866],
        [-83.17680358886719, 42.313369811689746]
      ]
    ]
  },
  graphOpts
);

const Z = 9;

var Metrics = function(store) {
  this.store = store;
};

// PROCESS EVENTS

Metrics.prototype.change = function(change, provider, done) {
  var d = new Date(Math.round(change.event_time) * 1000);
  var times = [day(d), hour(d), quarter(d)];

  var q = queue(1);

  q.defer(cb => {
    this.events(change, times, provider, cb);
  });
  q.defer(cb => {
    this.utilization(change, times, provider, cb);
  });
  q.defer(cb => {
    this.availability(change, times, provider, cb);
  });

  q.awaitAll(() => {
    done();
  });
};

Metrics.prototype.trip = function(trip, provider, done) {
  var d = new Date(trip.start_time * 1000);
  var times = [day(d), hour(d), quarter(d)];

  var q = queue(1);

  q.defer(cb => {
    this.streets(trip, times, provider, cb);
  });
  q.defer(cb => {
    this.vehicles(trip, times, provider, cb);
  });
  q.defer(cb => {
    this.pickups(trip, times, provider, cb);
  });
  q.defer(cb => {
    this.dropoffs(trip, times, provider, cb);
  });
  q.defer(cb => {
    this.pickupsvia(trip, times, provider, cb);
  });
  q.defer(cb => {
    this.dropoffsvia(trip, times, provider, cb);
  });

  q.awaitAll(() => {
    done();
  });
};

// AGGREGATORS

Metrics.prototype.events = function(change, times, provider, done) {
  var qtime = queue(1);

  times.forEach(time => {
    qtime.defer(timecb => {
      var id = provider + "!events!" + time + "!" + change.event_type;

      this.store.get(id, (err, record) => {
        if (!record) record = 1;
        else record++;

        this.store.put(id, record, err => {
          if (err) throw err;
          timecb();
        });
      });
    });
  });

  qtime.awaitAll(() => {
    done();
  });
};

Metrics.prototype.utilization = function(change, times, provider, done) {
  // todo: WIP, refactoring window selection on this metric
  //       for calculating denominator
  done();
};

Metrics.prototype.availability = function(change, times, provider, done) {
  // todo: WIP, refactoring window selection on this metric
  //       for calculating denominator
  done();
};

Metrics.prototype.vehicles = function(trip, times, provider, done) {
  var h3s = new Set();

  trip.route.features.forEach(ping => {
    var bin = h3.geoToH3(
      ping.geometry.coordinates[1],
      ping.geometry.coordinates[0],
      Z
    );
    h3s.add(bin);
  });

  var qspace = queue(1);
  h3s.forEach(bin => {
    qspace.defer(spacecb => {
      var qtime = queue(1);
      times.forEach(time => {
        qtime.defer(timecb => {
          var id = provider + "!vehicles!" + time + "!" + bin;

          this.store.get(id, (err, record) => {
            if (!record) record = 1;
            else record++;

            this.store.put(id, record, err => {
              if (err) throw err;
              timecb();
            });
          });
        });
      });

      qtime.awaitAll(() => {
        spacecb();
      });
    });
  });

  qspace.awaitAll(() => {
    done();
  });
};

Metrics.prototype.streets = function(trip, times, provider, done) {
  var shsts = new Set();

  var line = turf.lineString(
    trip.route.features.map(ping => {
      return ping.geometry.coordinates;
    })
  );

  graph.match(line).then(data => {
    var qedge = queue(1);

    // todo: throw err if segments not equal to linestrings count
    if (
      data &&
      data.segments &&
      data.matchedPath &&
      data.matchedPath.geometry &&
      data.matchedPath.geometry.coordinates &&
      data.matchedPath.geometry.coordinates.length === data.segments.length
    ) {
      data.segments
        .map((segment, s) => {
          return turf.lineString(data.matchedPath.geometry.coordinates[s], {
            referenceId: segment.referenceId
          });
        })
        .forEach(f => {
          qedge.defer(edgecb => {
            var qtime = queue(1);
            times.forEach(time => {
              qtime.defer(timecb => {
                var id =
                  provider +
                  "!streets!" +
                  time +
                  "!" +
                  f.properties.referenceId;

                this.store.put(
                  "geo!" + f.properties.referenceId,
                  JSON.stringify(f.geometry),
                  err => {
                    this.store.get(id, (err, record) => {
                      if (!record) {
                        record = 1;
                      } else record++;

                      this.store.put(id, record, err => {
                        if (err) throw err;

                        timecb();
                      });
                    });
                  }
                );
              });
            });

            qtime.awaitAll(() => {
              edgecb();
            });
          });
        });

      qedge.awaitAll(() => {
        done();
      });
    } else done();
  });
};

Metrics.prototype.pickups = function(trip, times, provider, done) {
  var bin = h3.geoToH3(
    trip.route.features[0].geometry.coordinates[1],
    trip.route.features[0].geometry.coordinates[0],
    Z
  );

  var qtime = queue(1);
  times.forEach(time => {
    qtime.defer(timecb => {
      var id = provider + "!pickups!" + time + "!" + bin;

      this.store.get(id, (err, record) => {
        if (!record) record = 1;
        else record++;

        this.store.put(id, record, err => {
          if (err) throw err;
          timecb();
        });
      });
    });
  });

  qtime.awaitAll(() => {
    done();
  });
};

Metrics.prototype.dropoffs = function(trip, times, provider, done) {
  var bin = h3.geoToH3(
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[1],
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[0],
    Z
  );

  var qtime = queue(1);
  times.forEach(time => {
    qtime.defer(timecb => {
      var id = provider + "!dropoffs!" + time + "!" + bin;

      this.store.get(id, (err, record) => {
        if (!record) record = 1;
        else record++;

        this.store.put(id, record, err => {
          if (err) throw err;
          timecb();
        });
      });
    });
  });

  qtime.awaitAll(() => {
    done();
  });
};

Metrics.prototype.pickupsvia = function(trip, times, provider, done) {
  var binA = h3.geoToH3(
    trip.route.features[0].geometry.coordinates[1],
    trip.route.features[0].geometry.coordinates[0],
    Z
  );
  var binB = h3.geoToH3(
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[1],
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[0],
    Z
  );

  var qtime = queue(1);
  times.forEach(time => {
    qtime.defer(timecb => {
      var id = provider + "!pickupsvia!" + time + "!" + binA + "!" + binB;

      this.store.get(id, (err, record) => {
        if (!record) record = 1;
        else record++;

        this.store.put(id, record, err => {
          if (err) throw err;
          timecb();
        });
      });
    });
  });

  qtime.awaitAll(() => {
    done();
  });
};

Metrics.prototype.dropoffsvia = function(trip, times, provider, done) {
  var binA = h3.geoToH3(
    trip.route.features[0].geometry.coordinates[1],
    trip.route.features[0].geometry.coordinates[0],
    Z
  );
  var binB = h3.geoToH3(
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[1],
    trip.route.features[trip.route.features.length - 1].geometry.coordinates[0],
    Z
  );

  var qtime = queue(1);
  times.forEach(time => {
    qtime.defer(timecb => {
      var id = provider + "!dropoffsvia!" + time + "!" + binA + "!" + binB;

      this.store.get(id, (err, record) => {
        if (!record) record = 1;
        else record++;

        this.store.put(id, record, err => {
          if (err) throw err;
          timecb();
        });
      });
    });
  });

  qtime.awaitAll(() => {
    done();
  });
};

function day(d) {
  return moment(d).format("YYYY-MM-DD");
}

function hour(d) {
  return moment(d).format("YYYY-MM-DD-HH");
}

function quarter(d) {
  var timeKey = moment(d).format("YYYY-MM-DD-HH-");
  var minutes = ((Math.round((d.getMinutes() / 60) * 4) - 1) * 15).toString();
  if (minutes.length === 1) minutes = "0" + minutes;
  return timeKey + minutes;
}

module.exports = Metrics;

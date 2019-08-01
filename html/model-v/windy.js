/*  Global class for simulating the movement of particle through a 1km wind grid

    credit: All the credit for this work goes to: https://github.com/cambecc for creating the repo:
      https://github.com/cambecc/earth. The majority of this code is directly take nfrom there, since its awesome.

    This class takes a canvas element and an array of data (1km GFS from http://www.emc.ncep.noaa.gov/index.php?branch=GFS)
    and then uses a mercator (forward/reverse) projection to correctly map wind vectors in "map space".

    The "start" method takes the bounds of the map at its current extent and starts the whole gridding,
    interpolation and animation process.
*/
if (!Date.prototype.toISOString2) {
(function() {

function pad(number) {
  if (number < 10) {
    return '0' + number;
  }
  return number;
}

Date.prototype.toISOString2 = function() {
  return this.getUTCFullYear() +
    '-' + pad(this.getUTCMonth() + 1) +
    '-' + pad(this.getUTCDate()) +
    'T' + pad(this.getUTCHours()) +
    ':' + pad(this.getUTCMinutes()) +
    ':' + pad(this.getUTCSeconds()) +
    'Z';
};

}());
}

var Windy = function( params ){
  var VELOCITY_SCALE = params.velocityScale || 0.011;             // scale for wind velocity (completely arbitrary--this value looks nice)
  var MAX_WIND_INTENSITY = params.is_water ? 0.75 : 0.75;              // wind velocity at which particle intensity is maximum (m/s)
  var INTENSITY_SCALE_STEP = MAX_WIND_INTENSITY/254;            // step size of particle intensity color scale
  var MAX_PARTICLE_AGE = 16; //100;                // max number of frames a particle is drawn before regeneration
  var PARTICLE_LINE_WIDTH = 1;              // line width of a drawn particle
  var PARTICLE_MULTIPLIER = 1/100; //1/400;              // particle count scalar (completely arbitrary--this values looks nice)
  var PARTICLE_REDUCTION = 0.75;            // reduce particle count to this much of normal for mobile devices
  var FRAME_RATE = 20;                      // desired milliseconds per frame
  var TIMELAPSE_FRAMES = 1440;
  var TIMELAPSE_STEP = 1;
  var TIMELAPSE_LEAD_FRAMES = 60;
  var TIMELAPSE_TRAIL_FRAMES = 60;

  var NULL_WIND_VECTOR = [NaN, NaN, null];  // singleton for no wind in the form: [u, v, magnitude]
  var TRANSPARENT_BLACK = [255, 0, 0, 0];

  var τ = 2 * Math.PI;
  var H = Math.pow(10, -5.2);

  // interpolation for vectors like wind (u,v,m)
  var bilinearInterpolateVector = function(x, y, g00, g10, g01, g11) {
      var rx = (1 - x);
      var ry = (1 - y);
      var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
      var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
      var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
      return [u, v, Math.sqrt(u * u + v * v)];
  };


  var createWindBuilder = function(uComp, vComp, steps) {
    var start_date = new Date(uComp[0].header.refTime);
    start_date.setHours(start_date.getHours() + uComp[0].header.forecastTime);
    var end_date = new Date(uComp[uComp.length-1].header.refTime);
    end_date.setHours(end_date.getHours() + uComp[uComp.length-1].header.forecastTime);

      return {
          header: uComp[0].header,
          getData: function(i,t){
                  var p = (t % steps)/steps * (uComp.length-1), p0 = ~~p, p1 = p - p0;
                  var q = p0 == (uComp.length-1)? p0: p0+1;
                  return [uComp[p0].data[i]*(1-p1)+uComp[q].data[i]*(p1), vComp[p0].data[i]*(1-p1)+vComp[q].data[i]*(p1)];
               },
          interpolate: bilinearInterpolateVector,
          start_date: start_date,
          end_date: end_date
      }
  };

  var createBuilder = function(data) {
      var uComp = [], vComp = [], scalar = null;

      data.forEach(function(record) {
          switch (record.header.parameterCategory + "," + record.header.parameterNumber) {
              case "2,2": uComp.push(record); break;
              case "2,3": vComp.push(record); break;
              default:
                scalar = record;
          }
      });

      return createWindBuilder.bind(null, uComp, vComp, TIMELAPSE_FRAMES)();
  };

  var buildGrid = function(data, callback) {
      columns = [];
      var builder = createBuilder(data);

      var header = builder.header;
      var λ0 = header.lo1, φ0 = header.la1;  // the grid's origin (e.g., 0.0E, 90.0N)
      var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
      var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)

      // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
      // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
      var grid = [], p = 0;
      var isContinuous = Math.floor(ni * Δλ) >= 360;
      for (var j = 0; j < nj; j++) {
          var row = [];
          for (var i = 0; i < ni; i++, p++) {
              row[i] = p;
          }
          if (isContinuous) {
              // For wrapped grids, duplicate first column as last column to simplify interpolation logic
              row.push(row[0]);
          }
          grid[j] = Uint32Array.from(row);
      }

      function interpolate(λ, φ, t) {
          var i = floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
          var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

          var fi = Math.floor(i), ci = fi + 1;
          var fj = Math.floor(j), cj = fj + 1;

          var row;
          if ((row = grid[fj]) && row[fi] !== undefined && row[ci] !== undefined) {
              var g00 = builder.getData(row[fi],t);
              var g10 = builder.getData(row[ci],t);
              if (isValue(g00) && isValue(g10) && ((row = grid[cj])) && row[fi] !== undefined && row[ci] !== undefined) {
                  var g01 = builder.getData(row[fi],t);
                  var g11 = builder.getData(row[ci],t);
                  if (isValue(g01) && isValue(g11)) {
                      // All four points found, so interpolate the value.
                      return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                  }
              }
          }
          return null;
      }
      callback( {
          date: builder.start_date,
          start_date: builder.start_date,
          end_date: builder.end_date,
          interpolate: interpolate
      });
  };



  /**
   * @returns {Boolean} true if the specified value is not null and not undefined.
   */
  var isValue = function(x) {
      return x !== null && x !== undefined;
  }

  /**
   * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
   *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
   */
  var floorMod = function(a, n) {
      return a - n * Math.floor(a / n);
  }

  /**
   * @returns {Number} the value x clamped to the range [low, high].
   */
  var clamp = function(x, range) {
      return Math.max(range[0], Math.min(x, range[1]));
  }

  /**
   * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
   */
  var isMobile = function() {
      return (/android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i).test(navigator.userAgent);
  }

  /**
   * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
   * vector is modified in place and returned by this function.
   */
  var distort = function(λ, φ, x, y, scale, wind, extent) {
      var u = wind[0] * scale;
      var v = wind[1] * scale;
      var d = distortion(λ, φ, x, y, extent);

      // Scale distortion vectors by u and v, then add.
      wind[0] = d[0] * u + d[2] * v;
      wind[1] = d[1] * u + d[3] * v;
      return wind;
  };

  var distortion = function(λ, φ, x, y, extent) {
      var τ = 2 * Math.PI;
      var H = Math.pow(10, -5.2);
      var hλ = λ < 0 ? H : -H;
      var hφ = φ < 0 ? H : -H;

      var pλ = project(φ, λ + hλ, extent);
      var pφ = project(φ + hφ, λ, extent);

      // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1º λ
      // changes depending on φ. Without this, there is a pinching effect at the poles.
      var k = Math.cos(φ / 360 * τ);
      return [
          (pλ[0] - x) / hλ / k,
          (pλ[1] - y) / hλ / k,
          (pφ[0] - x) / hφ,
          (pφ[1] - y) / hφ
      ];
  };



  var createField = function(columns, bounds, callback) {
      function wind_fn(grid, p, extent, t){
        var velocityScale = VELOCITY_SCALE;
           t = t || 0;
          var wind = grid.interpolate(p[0], p[1], t);
          if (wind) {
            return distort(p[0], p[1], p[2], p[3], velocityScale, wind, extent);
          }
          return NULL_WIND_VECTOR;
      }

      /**
       * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
       *          is undefined at that point.
       */
      function field(grid, extent,x, y, t) {
          var column = columns[Math.round(x)];
          var iy = Math.round(y);
          if(column && column[iy]){
            return wind_fn(grid, column[iy],extent,t);
          }
          return NULL_WIND_VECTOR;
      }

      // Frees the massive "columns" array for GC. Without this, the array is leaked (in Chrome) each time a new
      // field is interpolated because the field closure's context is leaked, for reasons that defy explanation.
      field.release = function() {
          columns = [];
      };

      field.randomize = function(grid,o) {  // UNDONE: this method is terrible
          var x, y;
          var safetyNet = 0;
          do {
              x = Math.round(Math.floor(Math.random() * bounds.width) + bounds.x);
              y = Math.round(Math.floor((params.randomy?params.randomy():Math.random()) * bounds.height) + bounds.y)
          } while (field(grid,bounds,x, y)[2] === null && safetyNet++ < 0);
          o.x = x;
          o.y = y;
          return o;
      };

      //field.overlay = mask.imageData;
      //return field;
      callback( bounds, field );
  };

  var buildBounds = function( bounds, width, height ) {
      var upperLeft = bounds[0];
      var lowerRight = bounds[1];
      var x = Math.round(upperLeft[0]); //Math.max(Math.floor(upperLeft[0], 0), 0);
      var y = Math.max(Math.floor(upperLeft[1], 0), 0);
      var xMax = Math.min(Math.ceil(lowerRight[0], width), width - 1);
      var yMax = Math.min(Math.ceil(lowerRight[1], height), height - 1);
      return {x: x, y: y, xMax: width, yMax: yMax, width: width, height: height};
  };

  var deg2rad = function( deg ){
    return (deg / 180) * Math.PI;
  };

  var rad2deg = function( ang ){
    return ang / (Math.PI/180.0);
  };

  var invert = params.invert || function(x, y, extent){
    var mapLonDelta = extent.east - extent.west;
    var worldMapRadius = extent.width / rad2deg(mapLonDelta) * 360/(2 * Math.PI);
    var mapOffsetY = ( worldMapRadius / 2 * Math.log( (1 + Math.sin(extent.south) ) / (1 - Math.sin(extent.south))  ));
    var equatorY = extent.height + mapOffsetY;
    var a = (equatorY-y)/worldMapRadius;

    var lat = 180/Math.PI * (2 * Math.atan(Math.exp(a)) - Math.PI/2);
    var lon = rad2deg(extent.west) + x / extent.width * rad2deg(mapLonDelta);
    return [lon, lat];
  };

  var mercY = function( lat ) {
    return Math.log( Math.tan( lat / 2 + Math.PI / 4 ) );
  };

  var project = params.project || function( lat, lon, extent) { // both in radians, use deg2rad if neccessary
    var ymin = mercY(extent.south);
    var ymax = mercY(extent.north);
    var xFactor = extent.width / ( extent.east - extent.west );
    var yFactor = extent.height / ( ymax - ymin );

    var mercy = mercY( deg2rad(lat) );
    var x = (deg2rad(lon) - extent.west) * xFactor;
    var y = (ymax - mercy) * yFactor; // y points south
    return [x, y];
  };


  var interpolateField = function( grid, bounds, extent, callback ) {


    var columns = [];
    var x = bounds.x;

    function interpolateColumn(x) {
        var column = [];
        for (var y = bounds.y; y <= bounds.yMax; y += 2) {
                var coord = invert( x, y, extent );
                if (coord) {
                    var λ = coord[0], φ = coord[1];
                    var xi = x;
                    if (isFinite(λ)) {
                       column[y+1] = column[y] = [λ, φ, xi, y];
                    }
                }
        }
        columns[x+1] = columns[x] = column;
    }

    (function batchInterpolate() {
                var start = Date.now();
                while (x < bounds.width) {
                    interpolateColumn(x);
                    x += 2;
                    if ((Date.now() - start) > 1000) { //MAX_TASK_TIME) {
                        setTimeout(batchInterpolate, 25);
                        return;
                    }
                }
          createField(columns, bounds, callback);
    })();
  };


  var animate = function(grid, bounds, extent, field, start_date, end_date) {

    function asColorStyle(r, g, b, a) {
        return "rgba(" + 243 + ", " + 243 + ", " + 238 + ", " + a + ")";
    }

    function hexToR(h) {return parseInt((cutHex(h)).substring(0,2),16)}
    function hexToG(h) {return parseInt((cutHex(h)).substring(2,4),16)}
    function hexToB(h) {return parseInt((cutHex(h)).substring(4,6),16)}
    function cutHex(h) {return (h.charAt(0)=="#") ? h.substring(1,7):h}

    function windIntensityColorScale(step, maxWind) {
var alpha = 0.5;
        var result = [
"rgba(255, 253, 205, " + alpha + ")",
"rgba(254, 252, 203, " + alpha + ")",
"rgba(254, 250, 201, " + alpha + ")",
"rgba(253, 249, 199, " + alpha + ")",
"rgba(252, 248, 197, " + alpha + ")",
"rgba(252, 247, 194, " + alpha + ")",
"rgba(251, 246, 192, " + alpha + ")",
"rgba(250, 244, 190, " + alpha + ")",
"rgba(249, 243, 188, " + alpha + ")",
"rgba(249, 242, 186, " + alpha + ")",
"rgba(248, 241, 184, " + alpha + ")",
"rgba(247, 240, 182, " + alpha + ")",
"rgba(247, 238, 180, " + alpha + ")",
"rgba(246, 237, 177, " + alpha + ")",
"rgba(246, 236, 175, " + alpha + ")",
"rgba(245, 235, 173, " + alpha + ")",
"rgba(244, 234, 171, " + alpha + ")",
"rgba(243, 233, 169, " + alpha + ")",
"rgba(243, 231, 167, " + alpha + ")",
"rgba(242, 230, 165, " + alpha + ")",
"rgba(241, 229, 162, " + alpha + ")",
"rgba(241, 228, 160, " + alpha + ")",
"rgba(240, 227, 158, " + alpha + ")",
"rgba(239, 226, 156, " + alpha + ")",
"rgba(239, 225, 154, " + alpha + ")",
"rgba(238, 223, 152, " + alpha + ")",
"rgba(237, 222, 150, " + alpha + ")",
"rgba(237, 221, 147, " + alpha + ")",
"rgba(236, 220, 145, " + alpha + ")",
"rgba(235, 219, 143, " + alpha + ")",
"rgba(234, 218, 141, " + alpha + ")",
"rgba(234, 217, 139, " + alpha + ")",
"rgba(233, 216, 137, " + alpha + ")",
"rgba(232, 215, 134, " + alpha + ")",
"rgba(231, 214, 132, " + alpha + ")",
"rgba(231, 213, 130, " + alpha + ")",
"rgba(230, 212, 128, " + alpha + ")",
"rgba(229, 211, 126, " + alpha + ")",
"rgba(228, 210, 123, " + alpha + ")",
"rgba(227, 208, 121, " + alpha + ")",
"rgba(227, 207, 119, " + alpha + ")",
"rgba(226, 206, 117, " + alpha + ")",
"rgba(225, 205, 115, " + alpha + ")",
"rgba(224, 205, 113, " + alpha + ")",
"rgba(223, 204, 110, " + alpha + ")",
"rgba(222, 203, 108, " + alpha + ")",
"rgba(221, 202, 106, " + alpha + ")",
"rgba(220, 201, 104, " + alpha + ")",
"rgba(219, 200, 102, " + alpha + ")",
"rgba(218, 199, 100, " + alpha + ")",
"rgba(217, 198, 97, " + alpha + ")",
"rgba(216, 197, 95, " + alpha + ")",
"rgba(215, 196, 93, " + alpha + ")",
"rgba(214, 195, 91, " + alpha + ")",
"rgba(213, 194, 89, " + alpha + ")",
"rgba(212, 193, 87, " + alpha + ")",
"rgba(211, 193, 85, " + alpha + ")",
"rgba(210, 192, 83, " + alpha + ")",
"rgba(209, 191, 81, " + alpha + ")",
"rgba(208, 190, 79, " + alpha + ")",
"rgba(206, 189, 76, " + alpha + ")",
"rgba(205, 189, 74, " + alpha + ")",
"rgba(204, 188, 72, " + alpha + ")",
"rgba(203, 187, 70, " + alpha + ")",
"rgba(201, 186, 69, " + alpha + ")",
"rgba(200, 185, 67, " + alpha + ")",
"rgba(199, 185, 65, " + alpha + ")",
"rgba(197, 184, 63, " + alpha + ")",
"rgba(196, 183, 61, " + alpha + ")",
"rgba(195, 183, 59, " + alpha + ")",
"rgba(193, 182, 57, " + alpha + ")",
"rgba(192, 181, 55, " + alpha + ")",
"rgba(190, 180, 54, " + alpha + ")",
"rgba(189, 180, 52, " + alpha + ")",
"rgba(187, 179, 50, " + alpha + ")",
"rgba(186, 178, 48, " + alpha + ")",
"rgba(184, 178, 47, " + alpha + ")",
"rgba(183, 177, 45, " + alpha + ")",
"rgba(181, 176, 43, " + alpha + ")",
"rgba(180, 176, 42, " + alpha + ")",
"rgba(178, 175, 40, " + alpha + ")",
"rgba(177, 174, 39, " + alpha + ")",
"rgba(175, 174, 37, " + alpha + ")",
"rgba(173, 173, 35, " + alpha + ")",
"rgba(172, 173, 34, " + alpha + ")",
"rgba(170, 172, 32, " + alpha + ")",
"rgba(169, 171, 31, " + alpha + ")",
"rgba(167, 171, 30, " + alpha + ")",
"rgba(165, 170, 28, " + alpha + ")",
"rgba(164, 169, 27, " + alpha + ")",
"rgba(162, 169, 25, " + alpha + ")",
"rgba(160, 168, 24, " + alpha + ")",
"rgba(159, 168, 23, " + alpha + ")",
"rgba(157, 167, 21, " + alpha + ")",
"rgba(155, 166, 20, " + alpha + ")",
"rgba(154, 166, 19, " + alpha + ")",
"rgba(152, 165, 18, " + alpha + ")",
"rgba(150, 165, 16, " + alpha + ")",
"rgba(149, 164, 15, " + alpha + ")",
"rgba(147, 163, 14, " + alpha + ")",
"rgba(145, 163, 13, " + alpha + ")",
"rgba(143, 162, 12, " + alpha + ")",
"rgba(142, 162, 11, " + alpha + ")",
"rgba(140, 161, 10, " + alpha + ")",
"rgba(138, 160, 9, " + alpha + ")",
"rgba(136, 160, 8, " + alpha + ")",
"rgba(135, 159, 8, " + alpha + ")",
"rgba(133, 159, 7, " + alpha + ")",
"rgba(131, 158, 7, " + alpha + ")",
"rgba(129, 157, 6, " + alpha + ")",
"rgba(128, 157, 6, " + alpha + ")",
"rgba(126, 156, 6, " + alpha + ")",
"rgba(124, 156, 6, " + alpha + ")",
"rgba(122, 155, 6, " + alpha + ")",
"rgba(121, 154, 6, " + alpha + ")",
"rgba(119, 154, 6, " + alpha + ")",
"rgba(117, 153, 6, " + alpha + ")",
"rgba(115, 153, 6, " + alpha + ")",
"rgba(113, 152, 6, " + alpha + ")",
"rgba(112, 151, 7, " + alpha + ")",
"rgba(110, 151, 7, " + alpha + ")",
"rgba(108, 150, 7, " + alpha + ")",
"rgba(106, 149, 8, " + alpha + ")",
"rgba(104, 149, 9, " + alpha + ")",
"rgba(102, 148, 9, " + alpha + ")",
"rgba(101, 148, 10, " + alpha + ")",
"rgba(99, 147, 11, " + alpha + ")",
"rgba(97, 146, 11, " + alpha + ")",
"rgba(95, 146, 12, " + alpha + ")",
"rgba(93, 145, 13, " + alpha + ")",
"rgba(92, 144, 14, " + alpha + ")",
"rgba(90, 144, 15, " + alpha + ")",
"rgba(88, 143, 15, " + alpha + ")",
"rgba(86, 142, 16, " + alpha + ")",
"rgba(84, 142, 17, " + alpha + ")",
"rgba(82, 141, 18, " + alpha + ")",
"rgba(81, 140, 18, " + alpha + ")",
"rgba(79, 140, 19, " + alpha + ")",
"rgba(77, 139, 20, " + alpha + ")",
"rgba(75, 138, 21, " + alpha + ")",
"rgba(73, 138, 22, " + alpha + ")",
"rgba(72, 137, 22, " + alpha + ")",
"rgba(70, 136, 23, " + alpha + ")",
"rgba(68, 136, 24, " + alpha + ")",
"rgba(66, 135, 25, " + alpha + ")",
"rgba(64, 134, 25, " + alpha + ")",
"rgba(63, 133, 26, " + alpha + ")",
"rgba(61, 133, 27, " + alpha + ")",
"rgba(59, 132, 28, " + alpha + ")",
"rgba(57, 131, 28, " + alpha + ")",
"rgba(56, 131, 29, " + alpha + ")",
"rgba(54, 130, 30, " + alpha + ")",
"rgba(52, 129, 30, " + alpha + ")",
"rgba(50, 128, 31, " + alpha + ")",
"rgba(49, 127, 32, " + alpha + ")",
"rgba(47, 127, 32, " + alpha + ")",
"rgba(45, 126, 33, " + alpha + ")",
"rgba(44, 125, 33, " + alpha + ")",
"rgba(42, 124, 34, " + alpha + ")",
"rgba(40, 124, 35, " + alpha + ")",
"rgba(39, 123, 35, " + alpha + ")",
"rgba(37, 122, 36, " + alpha + ")",
"rgba(36, 121, 36, " + alpha + ")",
"rgba(34, 120, 37, " + alpha + ")",
"rgba(33, 120, 37, " + alpha + ")",
"rgba(31, 119, 38, " + alpha + ")",
"rgba(30, 118, 38, " + alpha + ")",
"rgba(28, 117, 39, " + alpha + ")",
"rgba(27, 116, 39, " + alpha + ")",
"rgba(26, 115, 39, " + alpha + ")",
"rgba(24, 115, 40, " + alpha + ")",
"rgba(23, 114, 40, " + alpha + ")",
"rgba(22, 113, 41, " + alpha + ")",
"rgba(21, 112, 41, " + alpha + ")",
"rgba(19, 111, 41, " + alpha + ")",
"rgba(18, 110, 42, " + alpha + ")",
"rgba(17, 109, 42, " + alpha + ")",
"rgba(16, 108, 42, " + alpha + ")",
"rgba(15, 108, 43, " + alpha + ")",
"rgba(15, 107, 43, " + alpha + ")",
"rgba(14, 106, 43, " + alpha + ")",
"rgba(13, 105, 43, " + alpha + ")",
"rgba(13, 104, 43, " + alpha + ")",
"rgba(12, 103, 44, " + alpha + ")",
"rgba(12, 102, 44, " + alpha + ")",
"rgba(11, 101, 44, " + alpha + ")",
"rgba(11, 100, 44, " + alpha + ")",
"rgba(11, 99, 44, " + alpha + ")",
"rgba(11, 98, 45, " + alpha + ")",
"rgba(11, 97, 45, " + alpha + ")",
"rgba(11, 96, 45, " + alpha + ")",
"rgba(11, 95, 45, " + alpha + ")",
"rgba(11, 94, 45, " + alpha + ")",
"rgba(12, 93, 45, " + alpha + ")",
"rgba(12, 92, 45, " + alpha + ")",
"rgba(12, 91, 45, " + alpha + ")",
"rgba(13, 90, 45, " + alpha + ")",
"rgba(13, 89, 45, " + alpha + ")",
"rgba(14, 88, 45, " + alpha + ")",
"rgba(14, 87, 45, " + alpha + ")",
"rgba(15, 86, 44, " + alpha + ")",
"rgba(15, 85, 44, " + alpha + ")",
"rgba(16, 84, 44, " + alpha + ")",
"rgba(16, 83, 44, " + alpha + ")",
"rgba(17, 82, 44, " + alpha + ")",
"rgba(17, 81, 44, " + alpha + ")",
"rgba(18, 80, 43, " + alpha + ")",
"rgba(18, 79, 43, " + alpha + ")",
"rgba(19, 78, 43, " + alpha + ")",
"rgba(19, 77, 43, " + alpha + ")",
"rgba(20, 76, 42, " + alpha + ")",
"rgba(20, 75, 42, " + alpha + ")",
"rgba(20, 74, 42, " + alpha + ")",
"rgba(21, 73, 42, " + alpha + ")",
"rgba(21, 72, 41, " + alpha + ")",
"rgba(22, 71, 41, " + alpha + ")",
"rgba(22, 70, 41, " + alpha + ")",
"rgba(22, 69, 40, " + alpha + ")",
"rgba(23, 68, 40, " + alpha + ")",
"rgba(23, 67, 39, " + alpha + ")",
"rgba(23, 66, 39, " + alpha + ")",
"rgba(23, 65, 39, " + alpha + ")",
"rgba(24, 64, 38, " + alpha + ")",
"rgba(24, 63, 38, " + alpha + ")",
"rgba(24, 63, 37, " + alpha + ")",
"rgba(24, 62, 37, " + alpha + ")",
"rgba(25, 61, 36, " + alpha + ")",
"rgba(25, 60, 36, " + alpha + ")",
"rgba(25, 59, 35, " + alpha + ")",
"rgba(25, 58, 35, " + alpha + ")",
"rgba(25, 57, 34, " + alpha + ")",
"rgba(25, 56, 34, " + alpha + ")",
"rgba(25, 55, 33, " + alpha + ")",
"rgba(25, 54, 33, " + alpha + ")",
"rgba(25, 53, 32, " + alpha + ")",
"rgba(25, 52, 31, " + alpha + ")",
"rgba(25, 51, 31, " + alpha + ")",
"rgba(25, 50, 30, " + alpha + ")",
"rgba(25, 49, 30, " + alpha + ")",
"rgba(25, 48, 29, " + alpha + ")",
"rgba(25, 47, 28, " + alpha + ")",
"rgba(25, 46, 28, " + alpha + ")",
"rgba(25, 45, 27, " + alpha + ")",
"rgba(25, 44, 26, " + alpha + ")",
"rgba(25, 44, 25, " + alpha + ")",
"rgba(25, 43, 25, " + alpha + ")",
"rgba(25, 42, 24, " + alpha + ")",
"rgba(24, 41, 23, " + alpha + ")",
"rgba(24, 40, 23, " + alpha + ")",
"rgba(24, 39, 22, " + alpha + ")",
"rgba(24, 38, 21, " + alpha + ")",
"rgba(24, 37, 20, " + alpha + ")",
"rgba(23, 36, 19, " + alpha + ")",
"rgba(23, 35, 19, " + alpha + ")"

        ]
        result.indexFor = function(m) {  // map wind speed to a style
            return Math.floor(Math.min(m, maxWind) / maxWind * (result.length - 1));
        };
        return result;
    }

    var colorStyles = windIntensityColorScale(INTENSITY_SCALE_STEP, MAX_WIND_INTENSITY);
    var buckets = colorStyles.map(function() { return []; });
    var etime = -1 * TIMELAPSE_LEAD_FRAMES;
    var start_time = start_date.getTime();
    var display_time = new Date();
    display_time.setTime(start_time);
    var duration = end_date.getTime()-start_date.getTime();

    var particleCount = Math.round(bounds.width * bounds.height * PARTICLE_MULTIPLIER);
    if (isMobile()) {
      particleCount *= PARTICLE_REDUCTION;
    }

    //var fadeFillStyle = "rgba(0, 0, 0, 0.97)";
    var fadeFillStyle = "rgba(0, 0, 0, 0.9)";
    var paintFillStyle = "rgba(0, 0, 0, 1.0)";

    var particles = [];
    for (var i = 0; i < particleCount; i++) {
        particles.push(field.randomize(grid,{age: Math.floor(Math.random() * MAX_PARTICLE_AGE) + 0}));
    }

    function evolve() {
      etime += TIMELAPSE_STEP;
      if(etime >= TIMELAPSE_FRAMES + TIMELAPSE_TRAIL_FRAMES){
        etime = TIMELAPSE_LEAD_FRAMES * -1 + 1;
      }
      var t = etime<0?0:etime>=TIMELAPSE_FRAMES?TIMELAPSE_FRAMES-1:etime;
      display_time.setTime(start_time+(t/TIMELAPSE_FRAMES-1)*duration);
      buckets.forEach(function(bucket) { bucket.length = 0; });
      for(var i=particles.length-1;i>0;i--){
        var particle = particles[i];
        if (particle.age >= MAX_PARTICLE_AGE) {
          field.randomize(grid,particle).age =  0;
        }
        var x = particle.x;
        var y = particle.y;
        var v = field(grid, extent, x, y, t);  // vector at current position and time
        var m = v[2];
        if (m === null) {
          particle.age = MAX_PARTICLE_AGE;  // particle has escaped the grid, never to return...
        }
        else {
          var xt = x + v[0];
          var yt = y + v[1];
          if (field(grid, extent, xt, yt)[2] !== null) {

            // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
            particle.xt = xt;
            particle.yt = yt;
            buckets[colorStyles.indexFor(m)].push(particle);
          }
          else {
            // Particle isn't visible, but it still moves through the field.
            particle.x = xt;
            particle.y = yt;
          }
        }

        particle.age += 1;
      }
    }

    var g = params.canvas.getContext("2d");
    g.lineWidth = PARTICLE_LINE_WIDTH;
    g.fillStyle = fadeFillStyle;

    function draw() {
        // Fade existing particle trails.
        var prev = g.globalCompositeOperation;
        g.globalCompositeOperation = "destination-in";
        //g.fillStyle = fadeFillStyle;
        g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        g.globalCompositeOperation = prev;
        //g.fillStyle = paintFillStyle;

        // Draw new particle trails.
        buckets.forEach(function(bucket, i) {
            if (bucket.length > 0) {
                g.beginPath();
                g.strokeStyle = colorStyles[i];
                bucket.forEach(function(particle) {
                    g.moveTo(particle.x, particle.y);
                    g.lineTo(particle.xt, particle.yt);
                    particle.x = particle.xt;
                    particle.y = particle.yt;
                });
                g.stroke();
            }
        });
        g.save();
        var txt = display_time.toISOString2();
        g.textBaseline = 'top';
        g.fillStyle = '#000';
        g.font = "14px Arial";
        g.fillRect(60,20,g.measureText(txt).width,14);
        g.fillStyle = "#FFF";
        g.fillText(txt, 60, 20);
        g.restore();
    }

    (function frame() {
        try {
            //windy.timer = setTimeout(function() {
              requestAnimationFrame(frame);
              evolve();
              draw();
              if(window.capturer){
                window.capturer.capture(params.canvas);
              }
            //}, 1000 / FRAME_RATE);
        }
        catch (e) {
            console.error(e);
        }
    })();
  }

  var start = function( bounds, width, height, extent ){
    var mapBounds = {
      south: deg2rad(extent[0][1]),
      north: deg2rad(extent[1][1]),
      east: deg2rad(extent[1][0]),
      west: deg2rad(extent[0][0]),
      width: width,
      height: height
    };

    stop();

    // build grid
    buildGrid( params.data, function(grid){
      var extent = mapBounds;
      // interpolateField
      interpolateField( grid, buildBounds( bounds, width, height), extent, function( bounds, field ){
        // animate the canvas with random points
        windy.field = field;
        animate( grid, bounds, extent, field, grid.start_date, grid.end_date );
      });

    });
  };

  var stop = function(){
    if (windy.field) windy.field.release();
    if (windy.timer) clearTimeout(windy.timer)
  };


  var windy = {
    params: params,
    start: start,
    stop: stop
  };

  return windy;
}



// shim layer with setTimeout fallback
window.requestAnimationFrame = (function(){
  return  window.requestAnimationFrame       ||
          window.webkitRequestAnimationFrame ||
          window.mozRequestAnimationFrame    ||
          window.oRequestAnimationFrame ||
          window.msRequestAnimationFrame ||
          function( callback ){
            window.setTimeout(callback, 1000 / 20);
          };
})();

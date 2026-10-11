// Which key combinations the MacBook Pro 2021 keyboard registers. Same rule as kbmatrix.py.
// Browser: <script src="kb-data.js"></script><script src="kbmatrix.js"></script>, then
// new KBMatrix.Matrix(KB.iso.data) (measured) or new KBMatrix.Matrix(KB.ansi.data) (US, derived, not measured).
// Node: const { Matrix } = require("./kbmatrix.js").
(function (root) {
  "use strict";

  function Matrix(data) {
    this.data = data;
    this.layout = data.layout || "iso";   // physical layout: "iso" or "ansi"
    this.rows = data.rows.map(function (r) { return r.id; });
    this.columns = data.columns.map(function (c) { return c.id; });
    this.keys = {};
    this.order = [];
    this.pos = {};
    this.at = {};
    this.byWebCode = {};
    var self = this;
    data.keys.forEach(function (k) {
      self.keys[k.id] = k;
      self.order.push(k.id);
      self.pos[k.id] = [k.row, k.column];
      self.at[k.row + "|" + k.column] = k.id;
      self.byWebCode[k.web_code] = k.id;
    });
    this.unidentified = {};
    this.spotNote = {};
    data.unidentified.forEach(function (u) {
      self.unidentified[u.row + "|" + u.column] = true;
      if (u.note) self.spotNote[u.row + "|" + u.column] = u.note;
    });
    // Keys on the keyboard whose place in the matrix is not known (the derived US keyboard's ` and \).
    this.unplaced = {};
    (data.unplaced || []).forEach(function (k) { self.unplaced[k.id] = k; });
    this.rollover = data.rollover || Infinity;   // the most keys registered at once
  }

  Matrix.prototype.label = function (k) { return (this.keys[k] || this.unplaced[k]).label; };

  Matrix.prototype.occupied = function (spot) {
    var s = spot[0] + "|" + spot[1];
    return s in this.at || s in this.unidentified;
  };

  Matrix.prototype.shares = function (a, b) {
    var p = this.pos[a], q = this.pos[b];
    return p[0] === q[0] || p[1] === q[1];
  };

  // {corner, spot} if the three keys form an L, else null.
  Matrix.prototype.lShape = function (a, b, c) {
    var sets = [[a, b, c], [b, a, c], [c, a, b]];
    for (var i = 0; i < 3; i++) {
      var x = sets[i][0], y = sets[i][1], z = sets[i][2];
      if (this.shares(y, z)) continue;
      var px = this.pos[x], py = this.pos[y], pz = this.pos[z];
      if (px[0] === py[0] && px[1] === pz[1]) return { corner: x, spot: [pz[0], py[1]] };
      if (px[1] === py[1] && px[0] === pz[0]) return { corner: x, spot: [py[0], pz[1]] };
    }
    return null;
  };

  Matrix.prototype.tripleBlocked = function (a, b, c) {
    var s = this.lShape(a, b, c);
    return s !== null && this.occupied(s.spot);
  };

  // Every 3-key part of `keys` the keyboard drops: [{keys, corner, spot}].
  Matrix.prototype.blockedTriples = function (keys) {
    var out = [];
    for (var i = 0; i < keys.length; i++)
      for (var j = i + 1; j < keys.length; j++)
        for (var k = j + 1; k < keys.length; k++) {
          var s = this.lShape(keys[i], keys[j], keys[k]);
          if (s && this.occupied(s.spot)) out.push({ keys: [keys[i], keys[j], keys[k]], corner: s.corner, spot: s.spot });
        }
    return out;
  };

  Matrix.prototype.registers = function (keys) {
    return keys.length <= this.rollover && this.blockedTriples(keys).length === 0;
  };

  // Keys that can not be added to `keys` (which must register).
  Matrix.prototype.wouldDrop = function (keys) {
    var self = this;
    if (keys.length >= this.rollover) return this.order.filter(function (x) { return keys.indexOf(x) < 0; });
    return this.order.filter(function (x) {
      if (keys.indexOf(x) >= 0) return false;
      for (var i = 0; i < keys.length; i++)
        for (var j = i + 1; j < keys.length; j++)
          if (self.tripleBlocked(keys[i], keys[j], x)) return true;
      return false;
    });
  };

  Matrix.prototype.occupant = function (spot) {
    var s = spot[0] + "|" + spot[1];
    if (s in this.at) return this.label(this.at[s]);
    if (s in this.spotNote) return "an unknown key (" + this.spotNote[s] + ")";
    if (s in this.unidentified) return "an unidentified key";
    return null;
  };

  Matrix.prototype.explain = function (t) {
    var self = this, corner = t.corner, pc = this.pos[corner];
    var others = t.keys.filter(function (x) { return x !== corner; });
    var rowMate = others.filter(function (x) { return self.pos[x][0] === pc[0]; })[0];
    var colMate = others.filter(function (x) { return self.pos[x][1] === pc[1]; })[0];
    return this.label(corner) + " shares row '" + pc[0] + "' with " + this.label(rowMate) + " and column '" + pc[1] +
      "' with " + this.label(colMate) + "; the fourth corner (row " + t.spot[0] + ", column " + t.spot[1] + ") holds " +
      this.occupant(t.spot) + ".";
  };

  var api = { Matrix: Matrix };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KBMatrix = api;
})(this);

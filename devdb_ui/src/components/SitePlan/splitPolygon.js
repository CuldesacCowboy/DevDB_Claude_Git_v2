// splitPolygon.js
// Polygon split geometry utilities for the site plan phase subdivision tool.
// All coordinates are normalized {x, y} in [0,1] unless noted as SVG screen coords.

// ─── Low-level 2D helpers (SVG screen space) ─────────────────────────────────

/**
 * Distance from point P to segment AB. Returns dist, parameter t, and
 * the closest point on the segment.
 */
export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const cx = ax + t * dx, cy = ay + t * dy
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy }
}

/**
 * Intersection of segment A→B with segment C→D.
 * Returns { t, u, x, y } where t ∈ [0,1] is position along A→B,
 * u ∈ [0,1] is position along C→D. Returns null if no intersection.
 */
export function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
  if (Math.abs(denom) < 1e-10) return null
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom
  if (t > 1e-6 && t <= 1 && u >= 0 && u <= 1) {
    return { t, u, x: ax + t * (bx - ax), y: ay + t * (by - ay) }
  }
  return null
}

// ─── Snap helpers (SVG screen space) ─────────────────────────────────────────

/**
 * Find the closest polygon VERTEX (corner) to (sx, sy) across all boundaries.
 * Returns { boundary, edgeIdx, svgPoint, normPoint } or null.
 * Higher priority than edge snapping — call this first, fall back to snapToBoundaries.
 */
export function snapToVertices(sx, sy, boundaries, normToScreen, threshold = 18) {
  let best = null, bestDist = threshold
  for (const b of boundaries) {
    const pts = JSON.parse(b.polygon_json)
    for (let i = 0; i < pts.length; i++) {
      const sp = normToScreen(pts[i].x, pts[i].y)
      const dist = Math.hypot(sx - sp.x, sy - sp.y)
      if (dist < bestDist) {
        bestDist = dist
        best = { boundary: b, edgeIdx: i, svgPoint: sp, normPoint: pts[i] }
      }
    }
  }
  return best
}

/**
 * Find the closest point on any boundary polygon edge to (sx, sy).
 * Returns { boundary, edgeIdx, svgPoint, normPoint } or null.
 */
export function snapToBoundaries(sx, sy, boundaries, normToScreen, screenToNorm, threshold = 18) {
  let best = null, bestDist = threshold
  for (const b of boundaries) {
    const pts = JSON.parse(b.polygon_json)
    const svg = pts.map(p => normToScreen(p.x, p.y))
    for (let i = 0; i < svg.length; i++) {
      const a = svg[i], nb = svg[(i + 1) % svg.length]
      const { dist, t, cx, cy } = distToSeg(sx, sy, a.x, a.y, nb.x, nb.y)
      if (dist < bestDist) {
        bestDist = dist
        // Interpolate directly in normalized space using t to avoid lossy screen→norm conversion
        const na = pts[i], nb_norm = pts[(i + 1) % pts.length]
        const normPt = { x: na.x + t * (nb_norm.x - na.x), y: na.y + t * (nb_norm.y - na.y) }
        best = { boundary: b, edgeIdx: i, svgPoint: { x: cx, y: cy }, normPoint: normPt }
      }
    }
  }
  return best
}

/**
 * Find the first intersection (smallest t along the new segment p1→p2) with
 * any boundary polygon edge. Used for auto-termination during split drawing.
 * Skips edges of `skipBoundary` that share an endpoint with the start of the line
 * to avoid immediately re-intersecting the edge the line started from.
 */
export function findFirstBoundaryIntersection(p1x, p1y, p2x, p2y, boundaries, normToScreen) {
  let earliest = null, earliestT = 1
  for (const b of boundaries) {
    const pts = JSON.parse(b.polygon_json)
    const svg = pts.map(p => normToScreen(p.x, p.y))
    for (let i = 0; i < svg.length; i++) {
      const a = svg[i], nb = svg[(i + 1) % svg.length]
      const ix = segIntersect(p1x, p1y, p2x, p2y, a.x, a.y, nb.x, nb.y)
      if (ix && ix.t < earliestT) {
        earliestT = ix.t
        // Interpolate in normalized space using u (position along the boundary edge) to avoid lossy conversion
        const na = pts[i], nb_norm = pts[(i + 1) % pts.length]
        const normPoint = { x: na.x + ix.u * (nb_norm.x - na.x), y: na.y + ix.u * (nb_norm.y - na.y) }
        earliest = { boundary: b, edgeIdx: i, svgPoint: { x: ix.x, y: ix.y }, normPoint }
      }
    }
  }
  return earliest
}

// ─── Auto split target detection ─────────────────────────────────────────────
//
// findBestSplit(polyline, boundaries) finds the polygon that the drawn polyline
// most significantly bisects — measured by how much of the polyline travels
// through each polygon's interior — and returns the portion of the polyline
// clipped to that polygon's boundary (ready to pass into splitPolygon).

const _ON_TOL = 1e-4

function _onBoundary(p, polygon) {
  for (let j = 0; j < polygon.length; j++) {
    const a = polygon[j], b = polygon[(j + 1) % polygon.length]
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
    if (len2 === 0) continue
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < _ON_TOL) return true
  }
  return false
}

function _pip(px, py, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function _inOrOn(p, polygon) {
  return _onBoundary(p, polygon) || _pip(p.x, p.y, polygon)
}

function _polyLen(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
  return s
}

/**
 * Clip the drawn polyline to the interior of a single polygon.
 * Returns [{x,y}] from boundary-entry to boundary-exit, or null if the
 * polyline doesn't actually bisect the polygon.
 */
function _clipPolylineTo(polyline, polygon) {
  const totalLen = _polyLen(polyline)
  if (totalLen < 1e-8) return null

  // Cumulative t ∈ [0,1] at each vertex
  const vt = [0]
  for (let i = 1; i < polyline.length; i++)
    vt.push(vt[i-1] + Math.hypot(polyline[i].x - polyline[i-1].x, polyline[i].y - polyline[i-1].y) / totalLen)

  // Collect boundary-crossing events: snapped endpoints + segment↔edge intersections
  const events = []
  if (_onBoundary(polyline[0], polygon))
    events.push({ t: 0, point: polyline[0] })
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i], b = polyline[i + 1]
    const sl = Math.hypot(b.x - a.x, b.y - a.y)
    for (let j = 0; j < polygon.length; j++) {
      const c = polygon[j], d = polygon[(j + 1) % polygon.length]
      const ix = segIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
      if (!ix) continue
      events.push({
        t: vt[i] + ix.t * (sl / totalLen),
        point: { x: c.x + ix.u * (d.x - c.x), y: c.y + ix.u * (d.y - c.y) },
      })
    }
  }
  if (_onBoundary(polyline[polyline.length - 1], polygon))
    events.push({ t: 1, point: polyline[polyline.length - 1] })

  events.sort((a, b) => a.t - b.t)
  const evts = events.filter((e, i) => i === 0 || e.t - events[i-1].t > 1e-6)
  if (evts.length < 2) return null

  // Interpolate a world-space point at global t along the polyline
  function ptAtT(t) {
    const target = t * totalLen
    let cum = 0
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i], b = polyline[i + 1]
      const sl = Math.hypot(b.x - a.x, b.y - a.y)
      if (cum + sl >= target - 1e-10) {
        const s = sl > 0 ? (target - cum) / sl : 0
        return { x: a.x + s * (b.x - a.x), y: a.y + s * (b.y - a.y) }
      }
      cum += sl
    }
    return polyline[polyline.length - 1]
  }

  // Find the pair of events that bracket the longest interior span where
  // every sub-interval between them also lies inside the polygon.
  let bestEntry = -1, bestExit = -1, bestSpan = 0
  for (let i = 0; i < evts.length - 1; i++) {
    for (let j = i + 1; j < evts.length; j++) {
      // Verify every sub-interval is inside
      let ok = true
      for (let k = i; k < j; k++) {
        if (!_inOrOn(ptAtT((evts[k].t + evts[k+1].t) / 2), polygon)) { ok = false; break }
      }
      if (!ok) continue
      const span = evts[j].t - evts[i].t
      if (span > bestSpan) { bestSpan = span; bestEntry = i; bestExit = j }
    }
  }
  if (bestEntry === -1) return null

  const entryT = evts[bestEntry].t
  const exitT  = evts[bestExit].t
  const interior = polyline.filter((_, i) => vt[i] > entryT + 1e-6 && vt[i] < exitT - 1e-6)
  return [evts[bestEntry].point, ...interior, evts[bestExit].point]
}

/**
 * Given a drawn polyline (normalized coords), find the boundary polygon it
 * most significantly bisects and return the line clipped to that polygon.
 *
 * "Most significantly" = the polygon through which the polyline travels the
 * greatest interior distance.  This lets the user draw from any boundary to
 * any other boundary and have the correct region auto-detected.
 *
 * Returns { boundary, clippedLine: [{x,y}] } or null.
 */
export function findBestSplit(polyline, boundaries) {
  if (!polyline || polyline.length < 2 || !boundaries?.length) return null
  let best = null, bestLen = 0
  for (const b of boundaries) {
    const polygon = JSON.parse(b.polygon_json)
    const clipped = _clipPolylineTo(polyline, polygon)
    if (!clipped || clipped.length < 2) continue
    const len = _polyLen(clipped)
    if (len > bestLen) { bestLen = len; best = { boundary: b, clippedLine: clipped } }
  }
  return best
}

// ─── Polygon split algorithm (normalized space) ───────────────────────────────

/**
 * Insert a point onto the closest edge of a polygon boundary.
 * Returns { poly: newPoly, idx: insertedIndex }.
 */
const EXISTING_VERTEX_TOL = 1e-6

function insertOnBoundary(poly, point) {
  // If point already coincides with an existing vertex, return it without inserting a duplicate.
  for (let i = 0; i < poly.length; i++) {
    if (Math.hypot(poly[i].x - point.x, poly[i].y - point.y) < EXISTING_VERTEX_TOL)
      return { poly, idx: i }
  }
  let bestEdge = 0, bestDist = Infinity, bestCx = point.x, bestCy = point.y
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0
    const cx = a.x + t * dx, cy = a.y + t * dy
    const dist = Math.hypot(point.x - cx, point.y - cy)
    if (dist < bestDist) { bestDist = dist; bestEdge = i; bestCx = cx; bestCy = cy }
  }
  const result = [...poly]
  // Insert the point projected onto the edge (not the raw input) to preserve exact topology
  result.splice(bestEdge + 1, 0, { x: bestCx, y: bestCy })
  return { poly: result, idx: bestEdge + 1 }
}

/**
 * Split a polygon along a polyline.
 *
 * splitLine: [{x,y}] — full line including start and end points, which must lie
 *   on or very near the polygon boundary.
 *
 * Returns [polyA, polyB] where each is [{x,y}], or null on failure.
 *
 * Algorithm:
 *   1. Insert start and end points onto the polygon boundary ring.
 *   2. Walk the ring from start→end (clockwise) and from end→start (clockwise)
 *      to form the two boundary arcs.
 *   3. Each arc + the split line interior (reversed for one) forms a closed polygon.
 */
export function splitPolygon(polygon, splitLine) {
  if (!polygon || polygon.length < 3) return null
  if (!splitLine || splitLine.length < 2) return null

  const start    = splitLine[0]
  const end      = splitLine[splitLine.length - 1]
  const interior = splitLine.slice(1, -1)  // vertices between start and end

  // Insert start point
  let { poly: p1, idx: i1 } = insertOnBoundary(polygon, start)
  // Insert end point into the result; track index shift
  let { poly: p2, idx: i2 } = insertOnBoundary(p1, end)
  if (i2 <= i1) i1++  // end was inserted before start, shifting its index

  // Ensure i1 < i2; if swapped, reverse interior so winding stays consistent
  let intFwd = interior
  if (i1 > i2) {
    ;[i1, i2] = [i2, i1]
    intFwd = [...interior].reverse()
  }

  // Boundary arc A: p2[i1 .. i2] (inclusive)
  const arcA = p2.slice(i1, i2 + 1)
  // Boundary arc B: p2[i2 .. end] + p2[0 .. i1] (wraps around)
  const arcB = [...p2.slice(i2), ...p2.slice(0, i1 + 1)]

  // Build polygons
  // PolyA: arcA + reversed interior  (start→boundary→end, then back via split line)
  const polyA = [...arcA, ...[...intFwd].reverse()]
  // PolyB: arcB + forward interior   (end→boundary→start, then back via split line)
  const polyB = [...arcB, ...intFwd]

  if (polyA.length < 3 || polyB.length < 3) return null
  return [polyA, polyB]
}

// ─── Topology normalization ────────────────────────────────────────────────────

/**
 * Snap vertices that are within `tol` of each other across all boundaries to
 * the exact same position (the first one encountered).  Prevents micro-gaps
 * caused by floating-point round-trips through screen ↔ normalized space.
 *
 * Returns [{boundary_id, polygon_json}] for only the boundaries that changed.
 * Mutates nothing — operates on copies.
 */
export function normalizeSharedVertices(boundaries, tol = 2e-4) {
  const polys = boundaries.map(b => ({
    boundary_id: b.boundary_id,
    pts: JSON.parse(b.polygon_json),
  }))

  for (let ai = 0; ai < polys.length; ai++) {
    for (let aj = 0; aj < polys[ai].pts.length; aj++) {
      const ref = polys[ai].pts[aj]
      for (let bi = ai; bi < polys.length; bi++) {
        const startJ = bi === ai ? aj + 1 : 0
        for (let bj = startJ; bj < polys[bi].pts.length; bj++) {
          const p = polys[bi].pts[bj]
          if (Math.hypot(p.x - ref.x, p.y - ref.y) < tol) {
            polys[bi].pts[bj] = { x: ref.x, y: ref.y }
          }
        }
      }
    }
  }

  // Return only boundaries whose vertices actually changed
  const changed = []
  for (let i = 0; i < polys.length; i++) {
    const orig = JSON.parse(boundaries[i].polygon_json)
    const modified = polys[i].pts.some((p, j) => p.x !== orig[j].x || p.y !== orig[j].y)
    if (modified) changed.push({ boundary_id: polys[i].boundary_id, polygon_json: JSON.stringify(polys[i].pts) })
  }
  return changed
}

/**
 * Merge two adjacent polygons by removing their shared boundary.
 *
 * The two polygons must share a contiguous sequence of vertices (the split
 * line between them).  The shared vertices appear in opposite traversal order
 * in the two polygons (standard winding invariant for adjacent planar regions).
 *
 * Algorithm:
 *   1. Find which poly1 vertices are shared with poly2 (within tol).
 *   2. Find chain1: the non-shared vertices in poly1, between two junction vertices.
 *   3. Walk poly2 forward from jAfter (in poly2) to jBefore (in poly2) to collect
 *      chain2 — the outer boundary of poly2 (non-shared side).
 *   4. merged = [jBefore, ...chain1, jAfter, ...chain2].
 *
 * Returns [{x,y}] or null on failure (topology mismatch, not enough shared vertices).
 */
export function mergeAdjacentPolygons(poly1, poly2, tol = 2e-4) {
  if (!poly1 || !poly2 || poly1.length < 3 || poly2.length < 3) return null

  // For each vertex in poly1, find matching index in poly2 (or -1)
  const match1to2 = poly1.map(p1 =>
    poly2.findIndex(p2 => Math.hypot(p1.x - p2.x, p1.y - p2.y) < tol)
  )

  // Need at least 2 shared vertices (junctions) to form a merge
  if (match1to2.filter(i => i !== -1).length < 2) return null

  // Find startIdx: first non-shared vertex whose predecessor IS shared
  let startIdx = -1
  for (let i = 0; i < poly1.length; i++) {
    const prev = (i + poly1.length - 1) % poly1.length
    if (match1to2[i] === -1 && match1to2[prev] !== -1) { startIdx = i; break }
  }
  if (startIdx === -1) return null  // entirely overlapping or no non-shared vertices

  // jBefore1: last shared vertex preceding the non-shared chain in poly1
  const jBefore1Idx = (startIdx + poly1.length - 1) % poly1.length
  const jBefore1      = poly1[jBefore1Idx]
  const jBefore1Poly2 = match1to2[jBefore1Idx]

  // Collect chain1 (non-shared run in poly1)
  const chain1 = []
  let idx = startIdx
  while (match1to2[idx] === -1) {
    chain1.push(poly1[idx])
    idx = (idx + 1) % poly1.length
    if (chain1.length > poly1.length) return null
  }

  // jAfter1: first shared vertex following chain1 in poly1
  const jAfter1      = poly1[idx]
  const jAfter1Poly2 = match1to2[idx]

  if (jBefore1Poly2 === -1 || jAfter1Poly2 === -1) return null

  // Walk poly2 FORWARD from jAfter1Poly2 to jBefore1Poly2 — this traverses the
  // outer (non-shared) boundary of poly2.
  const chain2 = []
  let j = (jAfter1Poly2 + 1) % poly2.length
  let iter = 0
  while (j !== jBefore1Poly2 && iter < poly2.length) {
    chain2.push(poly2[j])
    j = (j + 1) % poly2.length
    iter++
  }
  if (j !== jBefore1Poly2) return null  // topology mismatch — try cannot reach target

  const merged = [jBefore1, ...chain1, jAfter1, ...chain2]
  return merged.length >= 3 ? merged : null
}

// ─── Point-in-polygon (ray casting, normalized coords) ────────────────────────
export function pointInPolygon(px, py, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

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

// ─── Polygon split algorithm (normalized space) ───────────────────────────────

/**
 * Insert a point onto the closest edge of a polygon boundary.
 * Returns { poly: newPoly, idx: insertedIndex }.
 */
function insertOnBoundary(poly, point) {
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

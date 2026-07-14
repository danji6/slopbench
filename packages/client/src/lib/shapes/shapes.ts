import { CornerRounding } from './corner-rounding'
import { Matrix } from './matrix'
import { Offset } from './offset'
import { Point } from './point'
import { RoundedPolygon } from './rounded-polygon'

let _circle: RoundedPolygon | null = null
let _square: RoundedPolygon | null = null
let _slanted: RoundedPolygon | null = null
let _arch: RoundedPolygon | null = null
let _fan: RoundedPolygon | null = null
let _arrow: RoundedPolygon | null = null
let _semiCircle: RoundedPolygon | null = null
let _oval: RoundedPolygon | null = null
let _pill: RoundedPolygon | null = null
let _triangle: RoundedPolygon | null = null
let _diamond: RoundedPolygon | null = null
let _clamShell: RoundedPolygon | null = null
let _pentagon: RoundedPolygon | null = null
let _gem: RoundedPolygon | null = null
let _verySunny: RoundedPolygon | null = null
let _sunny: RoundedPolygon | null = null
let _cookie4Sided: RoundedPolygon | null = null
let _cookie6Sided: RoundedPolygon | null = null
let _cookie7Sided: RoundedPolygon | null = null
let _cookie9Sided: RoundedPolygon | null = null
let _cookie12Sided: RoundedPolygon | null = null
let _ghostish: RoundedPolygon | null = null
let _clover4Leaf: RoundedPolygon | null = null
let _clover8Leaf: RoundedPolygon | null = null
let _burst: RoundedPolygon | null = null
let _softBurst: RoundedPolygon | null = null
let _boom: RoundedPolygon | null = null
let _softBoom: RoundedPolygon | null = null
let _flower: RoundedPolygon | null = null
let _puffy: RoundedPolygon | null = null
let _puffyDiamond: RoundedPolygon | null = null
let _pixelCircle: RoundedPolygon | null = null
let _pixelTriangle: RoundedPolygon | null = null
let _bun: RoundedPolygon | null = null
let _heart: RoundedPolygon | null = null

const cornerRound15 = new CornerRounding(0.15)
const cornerRound20 = new CornerRounding(0.2)
const cornerRound30 = new CornerRounding(0.3)
const cornerRound50 = new CornerRounding(0.5)
const cornerRound100 = new CornerRounding(1.0)

const rotateNeg30 = new Matrix()
rotateNeg30.rotateZ(-30)
const rotateNeg45 = new Matrix()
rotateNeg45.rotateZ(-45)
const rotateNeg90 = new Matrix()
rotateNeg90.rotateZ(-90)
const rotateNeg135 = new Matrix()
rotateNeg135.rotateZ(-135)
const rotate30 = new Matrix()
rotate30.rotateZ(30)
const rotate45 = new Matrix()
rotate45.rotateZ(45)
const rotate60 = new Matrix()
rotate60.rotateZ(60)
const rotate90 = new Matrix()
rotate90.rotateZ(90)
const rotate120 = new Matrix()
rotate120.rotateZ(120)
const rotate135 = new Matrix()
rotate135.rotateZ(135)
const rotate180 = new Matrix()
rotate180.rotateZ(180)

const rotate28th = new Matrix()
rotate28th.rotateZ(360 / 28)
const rotateNeg16th = new Matrix()
rotateNeg16th.rotateZ(-360 / 16)

function getCircle(): RoundedPolygon {
  if (_circle !== null) return _circle
  _circle = circle()
  return _circle
}

function getSquare(): RoundedPolygon {
  if (_square !== null) return _square
  _square = square()
  return _square
}

function getSlanted(): RoundedPolygon {
  if (_slanted !== null) return _slanted
  _slanted = slanted()
  return _slanted
}

function getArch(): RoundedPolygon {
  if (_arch !== null) return _arch
  _arch = arch()
  return _arch
}

function getFan(): RoundedPolygon {
  if (_fan !== null) return _fan
  _fan = fan()
  return _fan
}

function getArrow(): RoundedPolygon {
  if (_arrow !== null) return _arrow
  _arrow = arrow()
  return _arrow
}

function getSemiCircle(): RoundedPolygon {
  if (_semiCircle !== null) return _semiCircle
  _semiCircle = semiCircle()
  return _semiCircle
}

function getOval(): RoundedPolygon {
  if (_oval !== null) return _oval
  _oval = oval()
  return _oval
}

function getPill(): RoundedPolygon {
  if (_pill !== null) return _pill
  _pill = pill()
  return _pill
}

function getTriangle(): RoundedPolygon {
  if (_triangle !== null) return _triangle
  _triangle = triangle()
  return _triangle
}

function getDiamond(): RoundedPolygon {
  if (_diamond !== null) return _diamond
  _diamond = diamond()
  return _diamond
}

function getClamShell(): RoundedPolygon {
  if (_clamShell !== null) return _clamShell
  _clamShell = clamShell()
  return _clamShell
}

function getPentagon(): RoundedPolygon {
  if (_pentagon !== null) return _pentagon
  _pentagon = pentagon()
  return _pentagon
}

function getGem(): RoundedPolygon {
  if (_gem !== null) return _gem
  _gem = gem()
  return _gem
}

function getSunny(): RoundedPolygon {
  if (_sunny !== null) return _sunny
  _sunny = sunny()
  return _sunny
}

function getVerySunny(): RoundedPolygon {
  if (_verySunny !== null) return _verySunny
  _verySunny = verySunny()
  return _verySunny
}

function getCookie4Sided(): RoundedPolygon {
  if (_cookie4Sided !== null) return _cookie4Sided
  _cookie4Sided = cookie4()
  return _cookie4Sided
}

function getCookie6Sided(): RoundedPolygon {
  if (_cookie6Sided !== null) return _cookie6Sided
  _cookie6Sided = cookie6()
  return _cookie6Sided
}

function getCookie7Sided(): RoundedPolygon {
  if (_cookie7Sided !== null) return _cookie7Sided
  _cookie7Sided = cookie7()
  return _cookie7Sided
}

function getCookie9Sided(): RoundedPolygon {
  if (_cookie9Sided !== null) return _cookie9Sided
  _cookie9Sided = cookie9()
  return _cookie9Sided
}

function getCookie12Sided(): RoundedPolygon {
  if (_cookie12Sided !== null) return _cookie12Sided
  _cookie12Sided = cookie12()
  return _cookie12Sided
}

function getGhostish(): RoundedPolygon {
  if (_ghostish !== null) return _ghostish
  _ghostish = ghostish()
  return _ghostish
}

function getClover4Leaf(): RoundedPolygon {
  if (_clover4Leaf !== null) return _clover4Leaf
  _clover4Leaf = clover4()
  return _clover4Leaf
}

function getClover8Leaf(): RoundedPolygon {
  if (_clover8Leaf !== null) return _clover8Leaf
  _clover8Leaf = clover8()
  return _clover8Leaf
}

function getBurst(): RoundedPolygon {
  if (_burst !== null) return _burst
  _burst = burst()
  return _burst
}

function getSoftBurst(): RoundedPolygon {
  if (_softBurst !== null) return _softBurst
  _softBurst = softBurst()
  return _softBurst
}

function getBoom(): RoundedPolygon {
  if (_boom !== null) return _boom
  _boom = boom()
  return _boom
}

function getSoftBoom(): RoundedPolygon {
  if (_softBoom !== null) return _softBoom
  _softBoom = softBoom()
  return _softBoom
}

function getFlower(): RoundedPolygon {
  if (_flower !== null) return _flower
  _flower = flower()
  return _flower
}

function getPuffy(): RoundedPolygon {
  if (_puffy !== null) return _puffy
  _puffy = puffy()
  return _puffy
}

function getPuffyDiamond(): RoundedPolygon {
  if (_puffyDiamond !== null) return _puffyDiamond
  _puffyDiamond = puffyDiamond()
  return _puffyDiamond
}

function getPixelCircle(): RoundedPolygon {
  if (_pixelCircle !== null) return _pixelCircle
  _pixelCircle = pixelCircle()
  return _pixelCircle
}

function getPixelTriangle(): RoundedPolygon {
  if (_pixelTriangle !== null) return _pixelTriangle
  _pixelTriangle = pixelTriangle()
  return _pixelTriangle
}

function getBun(): RoundedPolygon {
  if (_bun !== null) return _bun
  _bun = bun()
  return _bun
}

function getHeart(): RoundedPolygon {
  if (_heart !== null) return _heart
  _heart = heart()
  return _heart
}

function circle(): RoundedPolygon {
  return RoundedPolygon.circle({ numVertices: 10 })
    .transformed((x, y) => {
      const offset = rotate45.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function square(): RoundedPolygon {
  return RoundedPolygon.rectangle({
    width: 1,
    height: 1,
    rounding: cornerRound30,
  }).normalized()
}

function slanted(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(
        new Offset(0.926, 0.97),
        new CornerRounding(0.189, 0.811),
      ),
      new PointNRound(
        new Offset(-0.021, 0.967),
        new CornerRounding(0.187, 0.057),
      ),
    ],
    2,
  ).normalized()
}

function arch(): RoundedPolygon {
  return RoundedPolygon.rectangle({
    width: 1,
    height: 1,
    rounding: CornerRounding.Unrounded,
    perVertexRounding: [
      cornerRound20,
      cornerRound20,
      cornerRound100,
      cornerRound100,
    ],
  })
    .normalized()
    .offset(0, -0.05)
}

function fan(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.004, 1.0), new CornerRounding(0.148, 0.417)),
      new PointNRound(new Offset(0.0, 1.0), new CornerRounding(0.151)),
      new PointNRound(new Offset(0.0, -0.003), new CornerRounding(0.148)),
      new PointNRound(new Offset(0.978, 0.02), new CornerRounding(0.803)),
    ],
    1,
  )
    .normalized()
    .offset(0.05, -0.05)
}

function arrow(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.225, 1.06), new CornerRounding(0.211)),
      new PointNRound(new Offset(0.5, 0.892), new CornerRounding(0.313)),
      new PointNRound(new Offset(-0.216, 1.05), new CornerRounding(0.207)),
      new PointNRound(new Offset(0.499, -0.16), new CornerRounding(0.215, 1.0)),
    ],
    1,
  )
    .normalized()
    .offset(-0.02, -0.03)
}

function semiCircle(): RoundedPolygon {
  return RoundedPolygon.rectangle({
    width: 1.6,
    height: 1,
    rounding: CornerRounding.Unrounded,
    perVertexRounding: [
      cornerRound20,
      cornerRound20,
      cornerRound100,
      cornerRound100,
    ],
  })
    .normalized()
    .offset(0, -0.18)
}

function oval(): RoundedPolygon {
  const scaleMatrix = new Matrix()
  scaleMatrix.scale(1, 0.64)
  return RoundedPolygon.circle({})
    .transformed((x, y) => {
      const offset = rotateNeg90.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .transformed((x, y) => {
      const offset = scaleMatrix.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .transformed((x, y) => {
      const offset = rotate135.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function pill(): RoundedPolygon {
  return customPolygon(
    [
      // new PointNRound(new Offset(0.609, 0.000), new CornerRounding(1.000)),
      new PointNRound(new Offset(0.428, -0.001), new CornerRounding(0.426)),
      new PointNRound(new Offset(0.961, 0.039), new CornerRounding(0.426)),
      new PointNRound(new Offset(1.001, 0.428)),
      new PointNRound(new Offset(1.0, 0.609), new CornerRounding(1.0)),
    ],
    2,
  )
    .transformed((x, y) => {
      const offset = rotate180.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function triangle(): RoundedPolygon {
  return RoundedPolygon.fromNumVertices({
    numVertices: 3,
    radius: 1,
    centerX: 0.5,
    centerY: 0.5,
    rounding: cornerRound20,
  })
    .transformed((x, y) => {
      const offset = rotate30.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
    .offset(-0.015, -0.07)
}

function diamond(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.5, 1.096), new CornerRounding(0.151, 0.524)),
      new PointNRound(new Offset(0.04, 0.5), new CornerRounding(0.159)),
    ],
    2,
  ).normalized()
}

function clamShell(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.829, 0.841), new CornerRounding(0.159)),
      new PointNRound(new Offset(0.171, 0.841), new CornerRounding(0.159)),
      new PointNRound(new Offset(-0.02, 0.5), new CornerRounding(0.14)),
    ],
    2,
  ).normalized()
}

function pentagon(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.828, 0.97), new CornerRounding(0.169)),
      new PointNRound(new Offset(0.172, 0.97), new CornerRounding(0.169)),
      new PointNRound(new Offset(-0.03, 0.365), new CornerRounding(0.164)),
      new PointNRound(new Offset(0.5, -0.009), new CornerRounding(0.172)),
      new PointNRound(new Offset(1.03, 0.365), new CornerRounding(0.164)),
    ],
    1,
  )
    .normalized()
    .offset(0, -0.035)
}

function gem(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.005, 0.792), new CornerRounding(0.208)),
      new PointNRound(new Offset(0.5, 1.023), new CornerRounding(0.241, 0.778)),
      new PointNRound(new Offset(-0.005, 0.792), new CornerRounding(0.208)),
      new PointNRound(new Offset(0.073, 0.258), new CornerRounding(0.228)),
      new PointNRound(new Offset(0.5, 0.0), new CornerRounding(0.241, 0.778)),
      new PointNRound(new Offset(0.927, 0.258), new CornerRounding(0.228)),
    ],
    1,
  ).normalized()
}

function sunny(): RoundedPolygon {
  return RoundedPolygon.star({
    numVerticesPerRadius: 8,
    radius: 1,
    innerRadius: 0.8,
    rounding: cornerRound15,
  })
    .transformed((x, y) => {
      const offset = rotate45.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function verySunny(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.5, 1.08), new CornerRounding(0.085)),
      new PointNRound(new Offset(0.358, 0.843), new CornerRounding(0.085)),
    ],
    8,
  )
    .transformed((x, y) => {
      const offset = rotateNeg45.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function cookie4(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.237, 1.236), new CornerRounding(0.258)),
      new PointNRound(new Offset(0.5, 0.918), new CornerRounding(0.233)),
    ],
    4,
  ).normalized()
}

function cookie6(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.723, 0.884), new CornerRounding(0.394)),
      new PointNRound(new Offset(0.5, 1.099), new CornerRounding(0.398)),
    ],
    6,
  ).normalized()
}

function cookie7(): RoundedPolygon {
  const transform = (x: number, y: number) => {
    const offset = rotate28th.map(new Offset(x, y))
    return new Point(offset.x, offset.y)
  }
  return RoundedPolygon.star({
    numVerticesPerRadius: 7,
    radius: 1,
    innerRadius: 0.75,
    rounding: cornerRound50,
  })
    .normalized()
    .transformed(transform)
    .transformed(transform)
    .transformed(transform)
    .transformed(transform)
    .transformed(transform)
    .normalized()
}

function cookie9(): RoundedPolygon {
  return RoundedPolygon.star({
    numVerticesPerRadius: 9,
    radius: 1,
    innerRadius: 0.8,
    rounding: cornerRound50,
  })
    .transformed((x, y) => {
      const offset = rotate30.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function cookie12(): RoundedPolygon {
  return RoundedPolygon.star({
    numVerticesPerRadius: 12,
    radius: 1,
    innerRadius: 0.8,
    rounding: cornerRound50,
  })
    .transformed((x, y) => {
      const offset = rotate30.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function ghostish(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.0, 1.14), new CornerRounding(0.254, 0.106)),
      new PointNRound(new Offset(0.575, 0.906), new CornerRounding(0.253)),
      new PointNRound(new Offset(0.425, 0.906), new CornerRounding(0.253)),
      new PointNRound(new Offset(0.0, 1.14), new CornerRounding(0.254, 0.106)),
      new PointNRound(new Offset(0.0, 0.0), new CornerRounding(1.0)),
      new PointNRound(new Offset(0.5, 0.0), new CornerRounding(1.0)),
      new PointNRound(new Offset(1.0, 0.0), new CornerRounding(1.0)),
    ],
    1,
  )
    .normalized()
    .offset(0, -0.025)
}

function clover4(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.099, 0.725), new CornerRounding(0.476)),
      new PointNRound(new Offset(0.725, 1.099), new CornerRounding(0.476)),
      new PointNRound(new Offset(0.5, 0.926)),
    ],
    4,
  ).normalized()
}

function clover8(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.758, 1.101), new CornerRounding(0.209)),
      new PointNRound(new Offset(0.5, 0.964)),
    ],
    8,
  ).normalized()
}

function burst(): RoundedPolygon {
  const transform = (x: number, y: number) => {
    const offset = rotateNeg30.map(new Offset(x, y))
    return new Point(offset.x, offset.y)
  }
  return customPolygon(
    [
      new PointNRound(new Offset(0.592, 0.842), new CornerRounding(0.006)),
      new PointNRound(new Offset(0.5, 1.006), new CornerRounding(0.006)),
    ],
    12,
  )
    .transformed(transform)
    .transformed(transform)
    .normalized()
}

function softBurst(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.193, 0.277), new CornerRounding(0.053)),
      new PointNRound(new Offset(0.176, 0.055), new CornerRounding(0.053)),
    ],
    10,
  )
    .transformed((x, y) => {
      const offset = rotate180.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function boom(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.457, 0.296), new CornerRounding(0.007)),
      new PointNRound(new Offset(0.5, -0.051), new CornerRounding(0.007)),
    ],
    15,
  )
    .transformed((x, y) => {
      const offset = rotate120.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function softBoom(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.733, 0.454)),
      new PointNRound(new Offset(0.839, 0.437), new CornerRounding(0.532)),
      new PointNRound(new Offset(0.949, 0.449), new CornerRounding(0.439, 1.0)),
      new PointNRound(new Offset(0.998, 0.478), new CornerRounding(0.174)),
      // mirrored points
      new PointNRound(new Offset(0.998, 0.522), new CornerRounding(0.174)),
      new PointNRound(new Offset(0.949, 0.551), new CornerRounding(0.439, 1.0)),
      new PointNRound(new Offset(0.839, 0.563), new CornerRounding(0.532)),
      new PointNRound(new Offset(0.733, 0.546)),
    ],
    16,
  )
    .transformed((x, y) => {
      const offset = rotate45.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .transformed((x, y) => {
      const offset = rotateNeg16th.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function flower(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.37, 0.187)),
      new PointNRound(new Offset(0.416, 0.049), new CornerRounding(0.381)),
      new PointNRound(new Offset(0.479, 0.001), new CornerRounding(0.095)),
      // mirrored points
      new PointNRound(new Offset(0.521, 0.001), new CornerRounding(0.095)),
      new PointNRound(new Offset(0.584, 0.049), new CornerRounding(0.381)),
      new PointNRound(new Offset(0.63, 0.187)),
    ],
    8,
  )
    .transformed((x, y) => {
      const offset = rotate135.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function puffy(): RoundedPolygon {
  const m = new Matrix()
  m.scale(1, 0.742)
  const shape = customPolygon(
    [
      // mirrored points
      new PointNRound(new Offset(1.003, 0.563), new CornerRounding(0.255)),
      new PointNRound(new Offset(0.94, 0.656), new CornerRounding(0.126)),
      new PointNRound(new Offset(0.881, 0.654)),
      new PointNRound(new Offset(0.926, 0.711), new CornerRounding(0.66)),
      new PointNRound(new Offset(0.914, 0.851), new CornerRounding(0.66)),
      new PointNRound(new Offset(0.777, 0.998), new CornerRounding(0.36)),
      new PointNRound(new Offset(0.722, 0.872)),
      new PointNRound(new Offset(0.717, 0.934), new CornerRounding(0.574)),
      new PointNRound(new Offset(0.67, 1.035), new CornerRounding(0.426)),
      new PointNRound(new Offset(0.545, 1.04), new CornerRounding(0.405)),
      new PointNRound(new Offset(0.5, 0.947)),
      // original points
      new PointNRound(new Offset(0.5, 1 - 0.053)),
      new PointNRound(
        new Offset(1 - 0.545, 1 + 0.04),
        new CornerRounding(0.405),
      ),
      new PointNRound(
        new Offset(1 - 0.67, 1 + 0.035),
        new CornerRounding(0.426),
      ),
      new PointNRound(
        new Offset(1 - 0.717, 1 - 0.066),
        new CornerRounding(0.574),
      ),
      new PointNRound(new Offset(1 - 0.722, 1 - 0.128)),
      new PointNRound(
        new Offset(1 - 0.777, 1 - 0.002),
        new CornerRounding(0.36),
      ),
      new PointNRound(
        new Offset(1 - 0.914, 1 - 0.149),
        new CornerRounding(0.66),
      ),
      new PointNRound(
        new Offset(1 - 0.926, 1 - 0.289),
        new CornerRounding(0.66),
      ),
      new PointNRound(new Offset(1 - 0.881, 1 - 0.346)),
      new PointNRound(
        new Offset(1 - 0.94, 1 - 0.344),
        new CornerRounding(0.126),
      ),
      new PointNRound(
        new Offset(1 - 1.003, 1 - 0.437),
        new CornerRounding(0.255),
      ),
    ],
    2,
  )
  return shape
    .transformed((x, y) => {
      const offset = m.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function puffyDiamond(): RoundedPolygon {
  return customPolygon(
    [
      // original points
      new PointNRound(new Offset(0.87, 0.13), new CornerRounding(0.146)),
      new PointNRound(new Offset(0.818, 0.357)),
      new PointNRound(new Offset(1.0, 0.332), new CornerRounding(0.853)),
      // mirrored points
      new PointNRound(new Offset(1.0, 1 - 0.332), new CornerRounding(0.853)),
      new PointNRound(new Offset(0.818, 1 - 0.357)),
    ],
    4,
  )
    .transformed((x, y) => {
      const offset = rotate90.map(new Offset(x, y))
      return new Point(offset.x, offset.y)
    })
    .normalized()
}

function pixelCircle(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(1.0, 0.704)),
      new PointNRound(new Offset(0.926, 0.704)),
      new PointNRound(new Offset(0.926, 0.852)),
      new PointNRound(new Offset(0.843, 0.852)),
      new PointNRound(new Offset(0.843, 0.935)),
      new PointNRound(new Offset(0.704, 0.935)),
      new PointNRound(new Offset(0.704, 1.0)),
      new PointNRound(new Offset(0.5, 1.0)),
      new PointNRound(new Offset(1 - 0.704, 1.0)),
      new PointNRound(new Offset(1 - 0.704, 0.935)),
      new PointNRound(new Offset(1 - 0.843, 0.935)),
      new PointNRound(new Offset(1 - 0.843, 0.852)),
      new PointNRound(new Offset(1 - 0.926, 0.852)),
      new PointNRound(new Offset(1 - 0.926, 0.704)),
      new PointNRound(new Offset(1 - 1.0, 0.704)),
    ],
    2,
  ).normalized()
}

function pixelTriangle(): RoundedPolygon {
  return customPolygon(
    [
      // mirrored points
      new PointNRound(new Offset(0.888, 1 - 0.439)),
      new PointNRound(new Offset(0.789, 1 - 0.439)),
      new PointNRound(new Offset(0.789, 1 - 0.344)),
      new PointNRound(new Offset(0.675, 1 - 0.344)),
      new PointNRound(new Offset(0.674, 1 - 0.265)),
      new PointNRound(new Offset(0.56, 1 - 0.265)),
      new PointNRound(new Offset(0.56, 1 - 0.17)),
      new PointNRound(new Offset(0.421, 1 - 0.17)),
      new PointNRound(new Offset(0.421, 1 - 0.087)),
      new PointNRound(new Offset(0.287, 1 - 0.087)),
      new PointNRound(new Offset(0.287, 1 - 0.0)),
      new PointNRound(new Offset(0.113, 1 - 0.0)),
      // original points
      new PointNRound(new Offset(0.11, 0.5)),
      new PointNRound(new Offset(0.113, 0.0)),
      new PointNRound(new Offset(0.287, 0.0)),
      new PointNRound(new Offset(0.287, 0.087)),
      new PointNRound(new Offset(0.421, 0.087)),
      new PointNRound(new Offset(0.421, 0.17)),
      new PointNRound(new Offset(0.56, 0.17)),
      new PointNRound(new Offset(0.56, 0.265)),
      new PointNRound(new Offset(0.674, 0.265)),
      new PointNRound(new Offset(0.675, 0.344)),
      new PointNRound(new Offset(0.789, 0.344)),
      new PointNRound(new Offset(0.789, 0.439)),
      new PointNRound(new Offset(0.888, 0.439)),
    ],
    1,
  )
    .normalized()
    .offset(0.12, 0)
}

function bun(): RoundedPolygon {
  return customPolygon(
    [
      // original points
      new PointNRound(new Offset(0.796, 0.5)),
      new PointNRound(new Offset(0.853, 0.518), cornerRound100),
      new PointNRound(new Offset(0.992, 0.631), cornerRound100),
      new PointNRound(new Offset(0.968, 1.0), cornerRound100),
      // mirrored points
      new PointNRound(new Offset(0.032, 1 - 0.0), cornerRound100),
      new PointNRound(new Offset(0.008, 1 - 0.369), cornerRound100),
      new PointNRound(new Offset(0.147, 1 - 0.482), cornerRound100),
      new PointNRound(new Offset(0.204, 1 - 0.5)),
    ],
    2,
  ).normalized()
}

function heart(): RoundedPolygon {
  return customPolygon(
    [
      new PointNRound(new Offset(0.782, 0.611)),
      new PointNRound(new Offset(0.499, 0.946), new CornerRounding(0.0)),
      new PointNRound(new Offset(0.2175, 0.611)),
      new PointNRound(new Offset(-0.064, 0.276), new CornerRounding(1.0)),
      new PointNRound(new Offset(0.208, -0.066), new CornerRounding(0.958)),
      new PointNRound(new Offset(0.5, 0.268), new CornerRounding(0.016)),
      new PointNRound(new Offset(0.792, -0.066), new CornerRounding(0.958)),
      new PointNRound(new Offset(1.064, 0.276), new CornerRounding(1.0)),
    ],
    1,
  )
    .normalized()
    .offset(0, 0.05)
}

class PointNRound {
  o: Offset
  r: CornerRounding

  constructor(o: Offset, r: CornerRounding = CornerRounding.Unrounded) {
    this.o = o
    this.r = r
  }
}

function doRepeat(
  points: PointNRound[],
  reps: number,
  center: Offset,
  mirroring: boolean,
): PointNRound[] {
  if (mirroring) {
    const result: PointNRound[] = []
    const angles = points.map((p) => p.o.minus(center).angleDegrees())
    const distances = points.map((p) => p.o.minus(center).getDistance())
    const actualReps = reps * 2
    const sectionAngle = 360 / actualReps
    for (let it = 0; it < actualReps; it++) {
      for (let index = 0; index < points.length; index++) {
        const i = it % 2 === 0 ? index : points.length - 1 - index
        if (i > 0 || it % 2 === 0) {
          const baseAngle = angles[i]
          const angle =
            it * sectionAngle +
            (it % 2 === 0 ? baseAngle : 2 * angles[0] - baseAngle)
          const dist = distances[i]
          const rad = (angle * Math.PI) / 180
          const x = center.x + dist * Math.cos(rad)
          const y = center.y + dist * Math.sin(rad)
          result.push(new PointNRound(new Offset(x, y), points[i].r))
        }
      }
    }
    return result
  } else {
    const np = points.length
    const result: PointNRound[] = []
    for (let i = 0; i < np * reps; i++) {
      const point = points[i % np].o.rotateDegrees(
        (Math.floor(i / np) * 360) / reps,
        center,
      )
      result.push(new PointNRound(point, points[i % np].r))
    }
    return result
  }
}

function customPolygon(
  pnr: PointNRound[],
  reps: number,
  center: Offset = new Offset(0.5, 0.5),
  mirroring: boolean = false,
): RoundedPolygon {
  const actualPoints = doRepeat(pnr, reps, center, mirroring)
  const vertices: number[] = []
  for (const p of actualPoints) {
    vertices.push(p.o.x)
    vertices.push(p.o.y)
  }
  const perVertexRounding = actualPoints.map((p) => p.r)
  return RoundedPolygon.fromVertices({
    vertices,
    rounding: CornerRounding.Unrounded,
    perVertexRounding,
    centerX: center.x,
    centerY: center.y,
  })
}

export const Shapes = {
  circle: getCircle,
  square: getSquare,
  slanted: getSlanted,
  arch: getArch,
  fan: getFan,
  arrow: getArrow,
  semiCircle: getSemiCircle,
  oval: getOval,
  pill: getPill,
  triangle: getTriangle,
  diamond: getDiamond,
  clamShell: getClamShell,
  pentagon: getPentagon,
  gem: getGem,
  sunny: getSunny,
  verySunny: getVerySunny,
  cookie4Sided: getCookie4Sided,
  cookie6Sided: getCookie6Sided,
  cookie7Sided: getCookie7Sided,
  cookie9Sided: getCookie9Sided,
  cookie12Sided: getCookie12Sided,
  ghostish: getGhostish,
  clover4Leaf: getClover4Leaf,
  clover8Leaf: getClover8Leaf,
  burst: getBurst,
  softBurst: getSoftBurst,
  boom: getBoom,
  softBoom: getSoftBoom,
  flower: getFlower,
  puffy: getPuffy,
  puffyDiamond: getPuffyDiamond,
  pixelCircle: getPixelCircle,
  pixelTriangle: getPixelTriangle,
  bun: getBun,
  heart: getHeart,
}

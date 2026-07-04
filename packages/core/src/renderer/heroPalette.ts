import * as THREE from "three";
import { base64ToBytes } from "../util/base64";
import { configurePaletteTexture } from "./palette";

/**
 * The hero palette used in Stripe's hero wave, baked as a compact 32×32 RGBA colour LUT and stored inline as
 * base64 so no external image ships. It holds the full 2D colour field that flat stops can't reproduce. The wave
 * samples it by (gradient-coord, uv.y); linear filtering smooths the 32×32 grid back
 * to a continuous gradient.
 */
const SIZE = 32;

// prettier-ignore
const HERO_LUT_B64 =
  "7PP//97s///O4/7/xt77/8vc7f/Y1sr/5c2f/+/EcP/2vEX/+rQp//2xGP/+rRv//J5M//uUf//7jp7/+4a3//2Ax//9g83//4vD//2bu//5kpv/83V+//Nbb//3VnT/81Sf/+tdxf/pid3/56Pr/+a58v/q1/P/6On3/+Xy/P/o8f//2ur+/8/j/P/O4ff/1tzc/+PSr//sx4X/879d//i3Of/8siD//rEP//6vD//9nz7//JJ4//uNnP/6h7f//IDJ//yEz//+jMX//Jq8//aOnf/xa3n/9Fxq//dief/1Y5v/8G62/+2K0v/tq+b/6Lby/+rP8v/q5fb/5vH7/+Pv///X6P7/0uT6/9bi8P/h2sf/682R//LCa//3ukn/+rQs//yxGv/+sQ7//q4T//2eRP/8knv/+o2e//eIuf/6g8v/+obR//yMx//6mb3/84uh//Bnef/1YWn/+nVx//lzj//1g6X/8pjC//Gz3f/stO//6cDx/+rf9P/m8fv/3uz//9Xm/f/V4vj/3d/r/+fWtP/xyHT/9r9R//m3N//7siP//bAW//6xDv/+qxr//ZpP//yPf//4jZ//9Yq6//eHzP/4itL/+o/K//iYvv/wiab/7mZ9//Zpbv/7gG///Il+//iYk//1pa//9LTO//Cx5v/qru7/69fy/+fw+v/Y6f7/1eL7/9nb9v/h2Of/7M+n//XCW//5uj3/+7Ur//yxHf/9rhX//q8Q//6mJP/9k1f/+4x///aNnv/zjbr/9Y3N//aR1f/4lM7/+JnC//COrv/ua4f/9m5y//uGc//8k3z/+qKI//aupP/1tMT/8J3b/+iJ6v/qzfD/6O75/9fl/f/Y3vn/3NPz/+TM4P/uxpr/+LxJ//u3MP/8syX//a8c//2sF//+rBb//p8w//2OX//7ioD/9o6e//KQu//zk8//9ZjX//ec0//4nsn/85i7//B3mf/1cHz/+oZ4//uSgf/6oYX/97Kg//Wpvv/vcdH/5W7n/+vG7f/p6vf/1d78/9nX9//fyu3/6MDN//O8fv/6uDv/+7Qr//yxJf/9rB///akd//6oIP/+mz3//oxm//uMg//2kaD/8pW9//Ob0f/2oNj/+aPX//ul1P/4o83/9Iyy//d7kP/6in3/+5OB//qhgv/5rpX/9pyy/+9czf/kZ+D/7L7q/+vk9f/S0/v/2s30/+O+4//ttK3/+LRW//u0Mf/8si7//K8q//2pJv/9pSj//qMu//6WSP/+jWv/+46F//aVo//zmr//9KHS//em2v/8qNr//qra//2q2P/5n8z/+Iuv//uOjP/7loH//KGA//ukjf/5kab/8VjD/+dq2P/tt+b/7t3y/9XJ+P/gwvD/6bPa//Osmf/6sEn/+7E1//ywNf/8ri///agu//2jNf/+nz3//pRT//6Pb//8k4j/95um//Shwv/1p9T/+Krc//yr2//+rdv//q3c//yp2v/5mM3/+pKp//ubhv/8oIH//J6L//yPmv/2a7D/63fL/++z4//w1u7/48D0/+257f/zr9n/96ic//urU//8rT//+689//yyMv/9ry///qk///6jUP/+nGT//pt6//yfj//4pKz/9ajG//at1v/6r9z//azb//+u3f//r93//q7e//ug3P/6lcn/+52g//ujhP/9nIz//ZKb//qJpP/zjrr/8rHc//PN6v/zuO//+7Ts//uw4f/7qK7//KVo//ynTf/7rEb//bU0//27Jv/9tz3//bJj//6weP/+sIj//a+a//mwsv/2scn/+LTY//uz3f/9rtz//7De//6w3//+reL//aXl//ya4P/8nML//KSZ//2cm//9mrD//aGz//uitf/4r87/9sPk//u07f//tO3//rLo//ymwP/8nYL//J9g//unU//8skL//b0v//zBQP/8xHD//saJ//7FlP/9waP/+725//i5y//5u9j/+rjd//yv3f/+r9///q7i//6r5v/9quj//aTp//2e2v/9oLr//aC1//2ouv/+s7b//rSz//ywwP/6uNn//bPs//6z6//+ruP//J7G//uRmv/7knn/+51m//yrUv/9tkb//MBZ//3Lf//+0pP//tSa//7PqP/8yb7/+sLM//vC1v/6v9z/+bHd//io4v/7pej//arp//2x6P/8ren//KHg//2hxf/9p7v//rC3//+4s///u7D//rS5//2x0f//tO3//7Lr//6n3f/8ksL/+oKl//mDkf/5kXz//KNi//2vWP/+vnH//suQ//7Umv/+2Zz//tan//7SwP/9ysn//srO//vF1P/3sdH/7p7b/+2c6P/2o+3/9Kvs//Gn7f/xn+L//KXF//6uuv//sLj//7S1//+5sf/+tLn//q7Q//+z7f//sen//p/W//uEuv/5daf/9ned//aFjv/6l3f//adp//65ff/+ypr//tGh//7Vn//+1af//ta9///Rv///0r///cvD//m1uP/vn8n/5Jff/96b6//Um/H/zZvy/9Wb6v/ypc7//6+8//+xuf//tLb//7mx//22vf/+rtT//q/q//2n4v/9jsr/+3Wy//drqP/0cKL/9H2Z//iOhv/8oHT//rV///7Hnv/+zqf//tGm//7Uqv/+2Ln//9az///Xsv/90bT//MSj//m6r//tqcn/0aDh/76a8v+9m/b/vZn0/9ue4f/8q8L//rO0//+5rv/+vqn//LrB//6v2v/8qef//JnY//x7vv/6Zq3/9mSn//NtpP/ze53/94qN//yceP/+sn3//sWb//7Oqf/+0an//tas//7cuf//27D//96r//7aqv/+1Jz//tSe//rLrP/htc3/waPr/7if9v+ymvn/zJzt//eoxf/+t6D//8WV//7Kmf/8v8L//a/c//yk5f/7jtL/+224//lcqv/2X6b/9Gyj//R8mv/4jIr//J53//6zfv/+xZr//s2o//7Sqf/+2K7//uC8///htf//46z//t2m//7XnP/+2Z///tmh//XLt//Osdr/s6Lx/7Kd9v/Ro+z/9qvH//64mf//y4j//s+S//zBwf/9sNv//aHk//uI0P/7Zbf/+Feq//Vdpv/0bqD/+IKR//uWfv/+qHf//rqI//7Gnv/+zaf//tSp//7bsP/+477//+W4///mrv//3qT//tic//7Yn//+2qH//NWr/967zP+6pOj/waTt/+Gt4P/4r8j//bWi///Hiv/+zpP//cDB//6v2//9oOT/+4bR//pkuf/3WK3/9F+o//Vynf/6jIX//qR1//61fv/+v5H//seg//7Npv/+1an//t2y//7kwP//5rj//+ex///fpv/+2J3//tie//7ZoP/91qb/5r7E/8am3//Yq97/9LbN//qzxf/8sa///r+R//7MlP/9vcL//q7b//yh5f/6iNP/+Gi8//Vdr//0Zan/93qW//yXev/+rXH//rp///6/kf/+xp///s6l//7WrP/+37j//uXE///kuP//57X//+Os//7Znv/+2J3//tme//3Sof/vu7z/4KvW/+6xz//7tsP/+7PC//uruf/9rJ7//bWd//yzxv/+rtv/+6Ll//iM1P/2b77/9GWw//Vvpf/5hoz//KBy//6ya//+unn//r+Q//7HoP/+z6n//tmz//7iwv/+58j//+K2///mt//+5rT//9ui//7Wnv/+057//smg//u5rv/4ssX/+rTF//u0wP/7sL//+p+7//mRrf/5lK3/+qXL//6u2//4o+X/9JDU//R5vf/1cq7/93ud//qQhf/7pW///bJm//67dP/+wY///smj//7Sr//+3Lz//uXK//7ny///37T//+O0//7isv/+0Jb//8WH///AjP/+upf//rSh//2zsf/7tLz/+7S7//yttf/6lbX/94Oz//WEtv/2n8///a7c//Gn5f/wltH/9IO5//h+pv/7h5X/+5WD//ukcP/9smL//r1t//7Dif/+yaD//tOy//7gw//+6M3//ujM///dsv//3q3//tur//7Agf//r2j//6px//+og//+pY3//qiX//ywov/8r6f//Kei//yVo//6hKv/9Ie3//Og0P/8rtz/563k/+mZzv/zibP/+oag//qLlf/5k4n/+6Jx//2zXf/+vWL//sJ5//7Hkv/+0av//uDC//3pyv/96Mz//tux///apf/+1qb//7h+//+lZf//nGf//5dt//+Tc///lXn//qN+//unjP/5nJ3//JWb//2Knv/2i7L/8KLR//uu3P/druT/4ZXN/+2FtP/1g6X/94Wd//iMj//6nXX//a5f//64Xv/+vW3//sKB//7KmP/+2bP//ebE//3nzf/+2bH//tWf//7Vpf/+toX//5xk//+RW///iFj//4Nc//+FYv/+l2j/+599//eQmv/3iKT/94aj/++HtP/tn9H/+q7d/9aq5f/ajND/5Hq7/+13rv/yeaL/9YCU//mPgf/8oW3//q1m//60a//+uHb//sKJ//7Spv/+48D//ufO//7Xsv/+0Zr//tSk//68kv//mGn//4ZP//9+S///elD//oJa//2Qav/5kIT/9YOX//N7pP/ueK7/5nu7/+iX0//5rd3/0aXp/9KB1v/ba8P/5Wa2/+xoqf/yb5v/936M//uUef/9pWz//qxr//6ucf/+u4X//tGl//7jwv/959H//tez//7PmP/+0KL//sWh//6rh//+i2D//3xQ//59VP/+iF///It1//d9j//ybpv/7Wmn/+Zmtv/dasP/447W//es3v/LpO7/yHnd/89czf/bU8H/5VW1/+5dpv/1cJT/+419//6ibf/+pWj//qZt//63hf/+0ar//eTJ//3o1f/+1rX//c2X//3Lof/+x6b//cCh//6dev/+hlz//ohd//6TZP/8iXn/9m2V/+5apv/mVbb/20/B/89YzP/ahdv/9are/8eo8v+/eeX/xFXW/9FIzP/fSML/6VC0//Nlnv/7ioH//qFt//6jaP/+q3H//rqL//3Ssf/95s///efa//7WuP/8y5j//Mik//7FqP/9xan//a6J//6caf/+kmL//ptn//yKe//0X5//6ky2/99Ew//RQcv/wk/V/9CB4f/yq+D/x7L3/76I7f/AZOH/zFXX/9pS0P/mVsb/8Guw//mRkP/8p3z//K15//y4hP/8w5v/+9W7//vm1v/75t///NbC//nMpP/6yq7//Mmy//vIs//7vZv//LWC//yldf/8o3X/+paM//FgtP/kT8n/20zR/8pN1v+9W+D/y4jn//Cs4f/Pw/v/xqL0/8aF6//PeeT/23Xf/+V32P/uhsf/9qWs//i3mv/4v5j/+Meh//jPsv/43Mn/9+jf//fm5v/31tb/9dXB//XWyP/31sr/99XI//fOt//3yqj/98Of//e9nv/2r6//7oXO/+R63f/beeH/z3vl/8aF7P/Soe3/8bHj/w==";

/** Draw the hero LUT onto a small canvas (for panel swatch previews). */
export function buildHeroPaletteCanvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const bytes = base64ToBytes(HERO_LUT_B64);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), SIZE, SIZE), 0, 0);
  }
  return cv;
}

/** Build the hero palette as a DataTexture. */
export function buildHeroPaletteTexture(): THREE.DataTexture {
  const tex = configurePaletteTexture(
    new THREE.DataTexture(
      base64ToBytes(HERO_LUT_B64),
      SIZE,
      SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    ),
  );
  tex.needsUpdate = true; // DataTexture starts stale — upload the LUT on first use
  return tex;
}

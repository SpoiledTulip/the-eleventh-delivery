// Publication copy: personal contact image removed.
const EGG_QR_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=';


const EGG_QR_W = 130;
const EGG_QR_H = 192;


const EGG_MESSAGE = '感谢你完成第十一单配送！';


const EGG_HINT = '左边那块板子，踩踩看？';


const EGG_HINT_FRAMES = 240;




let _eggQrImage = null;
let _eggQrReady = false;


function eggQrImage() {
  if (_eggQrImage) return _eggQrImage;
  try {
    const img = new Image();
    img.onload = function () { _eggQrReady = true; };
    img.onerror = function () { _eggQrReady = false; };
    img.src = EGG_QR_IMG;
    _eggQrImage = img;
  } catch (e) {
    
    _eggQrImage = null;
  }
  return _eggQrImage;
}


function eggQrReady() { return _eggQrReady; }


function preloadEggQr() { eggQrImage(); }
try {
  
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', preloadEggQr);
    } else {
      preloadEggQr();
    }
  }
} catch (e) {  }

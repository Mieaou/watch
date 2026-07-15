// mathCore.js

function calculateAltitude(p) {
    // h = 44330 * (1 - (P / 1013.25)^0.1903)
    if (p <= 0) return 0;
    return 44330 * (1 - Math.pow(p / 1013.25, 0.1903));
}

function calculateExpectedSpO2(h) {
    // SpO2_expected = 99.042 - 0.001 * h
    return 99.042 - 0.001 * h;
}

function calculatePaO2(spo2) {
    // PaO2 = (B + A)^(1/3) - (B - A)^(1/3)
    let s = spo2 / 100.0;
    if (s >= 1.0) s = 0.9999; // avoid division by zero
    if (s <= 0.0) return 0;
    
    let A = (11700 * s) / (1 - s);
    let B = Math.sqrt(503 + A * A);
    
    let pao2 = Math.cbrt(B + A) - Math.cbrt(B - A);
    return pao2;
}

function calculateSystemicShock(hr, spo2, sbp) {
    // SS = HR / (SBP * SpO2)
    if (sbp <= 0 || spo2 <= 0) return 0;
    return hr / (sbp * spo2);
}

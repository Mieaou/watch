// app.js - trigger rebuild for github pages
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

// DOM Elements
const btnConnect = document.getElementById('btn-connect');
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputSbp = document.getElementById('input-sbp');

const tabSimple = document.getElementById('tab-simple');
const tabAdvanced = document.getElementById('tab-advanced');
const viewSimple = document.getElementById('view-simple');
const viewAdvanced = document.getElementById('view-advanced');

const alertCard = document.getElementById('alert-card');
const alertType = document.getElementById('alert-type');
const alertText = document.getElementById('alert-text');
const batteryStatus = document.getElementById('battery-status');

// Value spans
const vHr = document.getElementById('val-hr');
const vSpo2 = document.getElementById('val-spo2');
const vCo2 = document.getElementById('val-co2');
const vP = document.getElementById('val-p');
const vH = document.getElementById('val-h');
const vSpo2Exp = document.getElementById('val-spo2-exp');
const vPao2 = document.getElementById('val-pao2');
const vSs = document.getElementById('val-ss');
const vDp = document.getElementById('val-dp');
const vBatt = document.getElementById('val-batt');

// App State
let sbp = parseInt(localStorage.getItem('sbp')) || 120;
inputSbp.value = sbp;

let bleDevice = null;
let bleServer = null;
let rxCharacteristic = null;
let dataBuffer = "";

// Event Listeners
btnConnect.addEventListener('click', connectBLE);
btnSettings.addEventListener('click', () => modalSettings.classList.remove('hidden'));
btnSaveSettings.addEventListener('click', () => {
    sbp = parseInt(inputSbp.value) || 120;
    localStorage.setItem('sbp', sbp);
    modalSettings.classList.add('hidden');
});

tabSimple.addEventListener('click', () => {
    tabSimple.classList.add('active');
    tabAdvanced.classList.remove('active');
    viewSimple.classList.remove('hidden');
    viewAdvanced.classList.add('hidden');
});

tabAdvanced.addEventListener('click', () => {
    tabAdvanced.classList.add('active');
    tabSimple.classList.remove('active');
    viewAdvanced.classList.remove('hidden');
    viewSimple.classList.add('hidden');
});

async function connectBLE() {
    try {
        console.log('Requesting Bluetooth Device...');
        btnConnect.innerText = 'Connecting...';
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [NUS_SERVICE_UUID] }]
        });
        
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
        
        console.log('Connecting to GATT Server...');
        bleServer = await bleDevice.gatt.connect();
        
        console.log('Getting Service...');
        const service = await bleServer.getPrimaryService(NUS_SERVICE_UUID);
        
        console.log('Getting Characteristic...');
        rxCharacteristic = await service.getCharacteristic(NUS_TX_UUID);
        
        await rxCharacteristic.startNotifications();
        rxCharacteristic.addEventListener('characteristicvaluechanged', handleData);
        
        btnConnect.innerText = 'Connected';
        btnConnect.classList.remove('primary');
        btnConnect.classList.add('success');
        batteryStatus.classList.remove('hidden');
        
    } catch(error) {
        console.log('BLE Connection Error: ', error);
        btnConnect.innerText = 'Connect BLE';
    }
}

function onDisconnected() {
    console.log('Device disconnected');
    btnConnect.innerText = 'Connect BLE';
    btnConnect.classList.add('primary');
    btnConnect.classList.remove('success');
    batteryStatus.classList.add('hidden');
    setAlert('ВНИМАНИЕ', 'Соединение потеряно.', 'orange');
}

const rawBleData = document.getElementById('raw-ble-data');

function handleData(event) {
    let value = event.target.value;
    let decoder = new TextDecoder('utf-8');
    let str = decoder.decode(value);
    
    // Process stream (since JSON might be split across MTU chunks)
    dataBuffer += str;
    
    let lastBrace = dataBuffer.lastIndexOf('}');
    if (lastBrace !== -1) {
        let jsonStr = dataBuffer.substring(0, lastBrace + 1);
        dataBuffer = dataBuffer.substring(lastBrace + 1);
        
        // Show raw packet in the debug console
        rawBleData.innerText = jsonStr;
        
        // Split by '} {' if multiple JSONs got batched
        let parts = jsonStr.replace(/}\s*{/g, '}|{').split('|');
        for (let p of parts) {
            try {
                let data = JSON.parse(p);
                updateDashboard(data);
            } catch(e) {
                console.error("JSON parse error:", e);
                rawBleData.innerText = "Error: " + e.message + "\nData: " + jsonStr;
            }
        }
    }
}

function updateDashboard(data) {
    let hr = data.hr || 0;
    let spo2 = data.spo2 || 0;
    let p = data.p || 0;
    let co2 = data.co2 || 0;
    let dp = data.dp || 0;
    let b = data.b !== undefined ? data.b : '--';
    let e = data.e !== undefined ? data.e : 0;
    
    // Update Simple UI
    vHr.innerText = hr || '--';
    vSpo2.innerText = spo2 || '--';
    vP.innerText = p ? p.toFixed(1) : '--';
    vCo2.innerText = co2 || '--';
    vBatt.innerText = b;
    
    // Update Advanced UI (Math Core)
    let h = calculateAltitude(p);
    let spo2Exp = calculateExpectedSpO2(h);
    let pao2 = calculatePaO2(spo2);
    let ss = calculateSystemicShock(hr, spo2, sbp);
    
    vH.innerText = p > 0 ? Math.round(h) : '--';
    vSpo2Exp.innerText = h > 0 ? spo2Exp.toFixed(1) : '--';
    vPao2.innerText = pao2 > 0 ? pao2.toFixed(1) : '--';
    vSs.innerText = ss > 0 ? ss.toFixed(4) : '--';
    vDp.innerText = dp.toFixed(1);
    
    // Evaluate Logic Engine
    let advice = evaluateLogic(hr, spo2, p, co2, dp, sbp, e);
    setAlert(advice.type, advice.text, advice.color);
}

function setAlert(type, text, color) {
    alertType.innerText = type;
    alertText.innerText = text;
    
    alertCard.className = 'card alert-card'; // reset
    if (color && color !== 'default') {
        alertCard.classList.add(color);
    }
}

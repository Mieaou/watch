import machine
import time
import network
import socket
import json

# ==========================================
# HARDWARE CONFIGURATION & I2C SETUP
# ==========================================
# GP26 is I2C1 SDA, GP27 is I2C1 SCL
I2C_SDA_PIN = 26
I2C_SCL_PIN = 27

i2c = machine.I2C(1, sda=machine.Pin(I2C_SDA_PIN), scl=machine.Pin(I2C_SCL_PIN), freq=400000)

# Helper functions for binary decoding (trimming coefficients)
def unpack_s16(bytes_data, offset):
    val = bytes_data[offset] | (bytes_data[offset+1] << 8)
    if val & 0x8000:
        val -= 65536
    return val

def unpack_u16(bytes_data, offset):
    return bytes_data[offset] | (bytes_data[offset+1] << 8)

def unpack_s8(bytes_data, offset):
    val = bytes_data[offset]
    if val & 0x80:
        val -= 256
    return val

# ==========================================
# PRODUCTION-GRADE SENSOR DRIVERS
# ==========================================
class BMP388Driver:
    def __init__(self, i2c, addr=0x77):
        self.i2c = i2c
        self.addr = addr
        self.ok = False
        self.t_fine = 0.0
        try:
            chip_id = self.i2c.readfrom_mem(self.addr, 0x00, 1)[0]
            if chip_id in [0x50, 0x60]:
                self.ok = True
                self.i2c.writeto_mem(self.addr, 0x1B, b'\x33') # Enable pressure/temp
                self.read_calibration()
        except:
            pass

    def read_calibration(self):
        cal = self.i2c.readfrom_mem(self.addr, 0x31, 21)
        self.T1 = unpack_u16(cal, 0) / 0.00390625
        self.T2 = unpack_u16(cal, 2) / 1073741824.0
        self.T3 = unpack_s8(cal, 4) / 281474976710656.0
        self.P1 = (unpack_s16(cal, 5) - 16384) / 1048576.0
        self.P2 = (unpack_s16(cal, 7) - 16384) / 536870912.0
        self.P3 = unpack_s8(cal, 9) / 4294967296.0
        self.P4 = unpack_s8(cal, 10) / 137438953472.0
        self.P5 = unpack_u16(cal, 11) / 0.125
        self.P6 = unpack_u16(cal, 13) / 64.0
        self.P7 = unpack_s8(cal, 15) / 256.0
        self.P8 = unpack_s8(cal, 16) / 32768.0
        self.P9 = unpack_s16(cal, 17) / 281474976710656.0
        self.P10 = unpack_s8(cal, 19) / 281474976710656.0
        self.P11 = unpack_s8(cal, 20) / 36893488147419103232.0

    def read(self):
        if not self.ok: return 0.0
        try:
            data = self.i2c.readfrom_mem(self.addr, 0x04, 6)
            adc_p = data[0] | (data[1] << 8) | (data[2] << 16)
            adc_t = data[3] | (data[4] << 8) | (data[5] << 16)
            
            # Temp compensation
            pd1 = adc_t - self.T1
            pd2 = pd1 * self.T2
            self.t_fine = pd2 + (pd1 * pd1) * self.T3
            
            # Pressure compensation
            pd1 = self.P6 * self.t_fine
            pd2 = self.P7 * (self.t_fine ** 2)
            pd3 = self.P8 * (self.t_fine ** 3)
            po1 = self.P5 + pd1 + pd2 + pd3
            
            pd1 = self.P2 * self.t_fine
            pd2 = self.P3 * (self.t_fine ** 2)
            pd3 = self.P4 * (self.t_fine ** 3)
            po2 = adc_p * (self.P1 + pd1 + pd2 + pd3)
            
            pd1 = adc_p ** 2
            pd2 = self.P9 + self.P10 * self.t_fine
            pd3 = pd1 * pd2
            pd4 = pd3 + (adc_p ** 3) * self.P11
            
            press = (po1 + po2 + pd4) / 100.0
            return press if (300 <= press <= 1100) else 0.0
        except:
            return 0.0

class SCD41Driver:
    def __init__(self, i2c, addr=0x62):
        self.i2c = i2c
        self.addr = addr
        self.ok = False
        self.last_co2 = 400
        self.last_read = time.ticks_ms() - 5000
        try:
            self.i2c.writeto(self.addr, b'\x3f\x86') # Stop measurement
            time.sleep(0.5)
            self.i2c.writeto(self.addr, b'\x21\xb1') # Start periodic mode
            self.ok = True
        except:
            pass

    def read(self):
        if not self.ok: return 0
        now = time.ticks_ms()
        # Query the physical sensor strictly every 5 seconds
        if time.ticks_diff(now, self.last_read) >= 5000:
            try:
                self.i2c.writeto(self.addr, b'\xec\x05') # Read command
                time.sleep(0.01)
                data = self.i2c.readfrom(self.addr, 9)
                co2 = (data[0] << 8) | data[1]
                if co2 > 0:
                    self.last_co2 = co2
                self.last_read = now
            except:
                pass
        return self.last_co2

class MAX30102Driver:
    def __init__(self, i2c, addr=0x57):
        self.i2c = i2c
        self.addr = addr
        self.ok = False
        self.ir_history = []
        self.red_history = []
        self.last_beat_time = 0
        self.bpm = 0
        self.spo2 = 0
        try:
            self.i2c.writeto_mem(self.addr, 0x09, b'\x40') # Reset
            time.sleep(0.2)
            self.i2c.readfrom_mem(self.addr, 0x00, 2) # Clear interrupts
            self.i2c.writeto_mem(self.addr, 0x08, b'\x10') # FIFO Config: Roll-over enabled
            self.i2c.writeto_mem(self.addr, 0x09, b'\x03') # Mode: SpO2 mode
            self.i2c.writeto_mem(self.addr, 0x0A, b'\x27') # SpO2 config
            self.i2c.writeto_mem(self.addr, 0x0C, b'\x24') # Red LED Amplitude
            self.i2c.writeto_mem(self.addr, 0x0D, b'\x24') # IR LED Amplitude
            
            # Clear FIFO pointers
            self.i2c.writeto_mem(self.addr, 0x04, b'\x00')
            self.i2c.writeto_mem(self.addr, 0x05, b'\x00')
            self.i2c.writeto_mem(self.addr, 0x06, b'\x00')
            self.ok = True
        except:
            pass

    def update(self):
        if not self.ok: return
        try:
            self.i2c.readfrom_mem(self.addr, 0x00, 2) # Clear interrupt registers
            wr_ptr = self.i2c.readfrom_mem(self.addr, 0x04, 1)[0]
            rd_ptr = self.i2c.readfrom_mem(self.addr, 0x06, 1)[0]
            num_samples = (wr_ptr - rd_ptr) & 31
            
            if num_samples == 0: return
            
            # Read and empty FIFO samples
            data = None
            for _ in range(num_samples):
                data = self.i2c.readfrom_mem(self.addr, 0x07, 6)
            
            if data is None: return
            
            red = ((data[0] & 0x03) << 16) | (data[1] << 8) | data[2]
            ir = ((data[3] & 0x03) << 16) | (data[4] << 8) | data[5]
            
            # Finger check
            if ir < 15000:
                self.ir_history.clear()
                self.red_history.clear()
                self.bpm = 0
                self.spo2 = 0
                return
                
            self.ir_history.append(ir)
            self.red_history.append(red)
            if len(self.ir_history) > 80:
                self.ir_history.pop(0)
                self.red_history.pop(0)
                
            if len(self.ir_history) < 30: return
            
            # SpO2 Estimation
            ir_max, ir_min = max(self.ir_history), min(self.ir_history)
            ir_dc = sum(self.ir_history) / len(self.ir_history)
            ir_ac = ir_max - ir_min
            
            red_max, red_min = max(self.red_history), min(self.red_history)
            red_dc = sum(self.red_history) / len(self.red_history)
            red_ac = red_max - red_min
            
            if ir_dc > 0 and red_dc > 0 and ir_ac > 0:
                r = (red_ac / red_dc) / (ir_ac / ir_dc)
                spo2_calc = 104 - 17 * r
                self.spo2 = min(100, max(70, int(spo2_calc)))
            
            # Peak Detection for Heart Rate
            now = time.ticks_ms()
            last_val = self.ir_history[-1]
            prev_val = self.ir_history[-2]
            if prev_val <= ir_dc < last_val:
                if time.ticks_diff(now, self.last_beat_time) > 450:
                    interval = time.ticks_diff(now, self.last_beat_time)
                    self.last_beat_time = now
                    if 450 < interval < 2000:
                        calc_bpm = 60000 / interval
                        self.bpm = int(calc_bpm) if self.bpm == 0 else int(self.bpm * 0.7 + calc_bpm * 0.3)
        except:
            pass

    def read(self):
        # If history is active (finger present) but BPM is not yet calculated, return -1 (calculating)
        if len(self.ir_history) > 0:
            bpm_val = self.bpm if self.bpm > 0 else -1
            spo2_val = self.spo2 if self.spo2 > 0 else -1
            return bpm_val, spo2_val
        return 0, 0

# ==========================================
# HARDWARE INITIALIZATION
# ==========================================
# BMP388 (checks 0x77, fallbacks to 0x76)
bmp = BMP388Driver(i2c, 0x77)
if not bmp.ok:
    bmp = BMP388Driver(i2c, 0x76)

scd = SCD41Driver(i2c)
max_sensor = MAX30102Driver(i2c)

# Build I2C status mask
err_mask = 0
if not bmp.ok: err_mask |= 1
if not scd.ok: err_mask |= 2
if not max_sensor.ok: err_mask |= 4

# Start local Access Point
ap = network.WLAN(network.AP_IF)
ap.active(True)
ap.config(essid="Pico-Sensor-Hub", password="password123")

# ==========================================
# PRODUCTION DASHBOARD WEB PAGE (Single-File)
# ==========================================
HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Sensor Hub Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0f111a;
            --card-bg: rgba(255, 255, 255, 0.03);
            --card-border: rgba(255, 255, 255, 0.08);
            --text-main: #ffffff;
            --text-muted: #8b92a5;
            --accent: #5e6ad2;
            --accent-glow: rgba(94, 106, 210, 0.4);
            
            --color-green: #2ecc71;
            --color-green-bg: rgba(46, 204, 113, 0.15);
            --color-yellow: #f1c40f;
            --color-yellow-bg: rgba(241, 196, 15, 0.15);
            --color-orange: #e67e22;
            --color-orange-bg: rgba(230, 126, 34, 0.15);
            --color-red: #e74c3c;
            --color-red-bg: rgba(231, 76, 60, 0.15);
            --color-default: var(--card-bg);
            --radius: 16px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            -webkit-font-smoothing: antialiased;
            min-height: 100vh;
        }
        #app-container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--card-border);
        }
        .header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .btn {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 14px;
            cursor: pointer;
            font-family: 'Outfit', sans-serif;
        }
        .icon-btn { border-radius: 50%; padding: 8px 12px; font-size: 16px; }
        .mode-toggle {
            display: flex;
            background: var(--card-bg);
            border-radius: 12px;
            padding: 4px;
        }
        .tab {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-family: 'Outfit', sans-serif;
            padding: 10px 0;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .tab.active {
            background: rgba(255,255,255,0.1);
            color: var(--text-main);
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: var(--radius);
            padding: 20px;
            backdrop-filter: blur(10px);
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .metric { display: flex; flex-direction: column; gap: 8px; }
        .metric .label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .metric .value { font-size: 28px; font-weight: 700; }
        .metric .unit { font-size: 14px; color: var(--text-muted); font-weight: 400; }
        .alert-card {
            transition: all 0.4s ease;
            background: var(--color-default);
            border-left: 4px solid var(--card-border);
        }
        .alert-card.green { background: var(--color-green-bg); border-left-color: var(--color-green); }
        .alert-card.yellow { background: var(--color-yellow-bg); border-left-color: var(--color-yellow); }
        .alert-card.orange { background: var(--color-orange-bg); border-left-color: var(--color-orange); }
        .alert-card.red { background: var(--color-red-bg); border-left-color: var(--color-red); }
        .alert-header { font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px; }
        .alert-body p { font-size: 16px; line-height: 1.4; font-weight: 500; }
        .modal {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            padding: 20px;
        }
        .modal-content { width: 100%; max-width: 400px; }
        .input-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
        .input-group label { font-size: 14px; color: var(--text-muted); }
        .input-group input {
            background: rgba(0,0,0,0.2);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 12px;
            border-radius: 8px;
            font-size: 16px;
            outline: none;
        }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div id="app-container">
        <header>
            <div class="mode-toggle" style="width: 220px;">
                <button id="tab-simple" class="tab active">Simple</button>
                <button id="tab-advanced" class="tab">Advanced</button>
            </div>
            <div class="header-right">
                <span style="font-size: 13px; color: var(--color-green);">● Connected</span>
                <button id="btn-settings" class="btn icon-btn">⚙️</button>
            </div>
        </header>

        <div id="alert-card" class="card alert-card">
            <div class="alert-header" id="alert-type">СОВЕТ</div>
            <div class="alert-body"><p id="alert-text">Сбор данных...</p></div>
        </div>

        <div id="view-simple" class="view">
            <div class="grid">
                <div class="card metric"><div class="label">Heart Rate</div><div class="value"><span id="val-hr">--</span> <span class="unit">bpm</span></div></div>
                <div class="card metric"><div class="label">SpO2</div><div class="value"><span id="val-spo2">--</span> <span class="unit">%</span></div></div>
                <div class="card metric"><div class="label">CO2 Level</div><div class="value"><span id="val-co2">--</span> <span class="unit">ppm</span></div></div>
                <div class="card metric"><div class="label">Pressure</div><div class="value"><span id="val-p">--</span> <span class="unit">hPa</span></div></div>
            </div>
        </div>

        <div id="view-advanced" class="view hidden">
            <div class="grid">
                <div class="card metric"><div class="label">Altitude (h)</div><div class="value"><span id="val-h">--</span> <span class="unit">m</span></div></div>
                <div class="card metric"><div class="label">Expected SpO2</div><div class="value"><span id="val-spo2-exp">--</span> <span class="unit">%</span></div></div>
                <div class="card metric"><div class="label">PaO2</div><div class="value"><span id="val-pao2">--</span> <span class="unit">mmHg</span></div></div>
                <div class="card metric"><div class="label">Systemic Shock</div><div class="value"><span id="val-ss">--</span></div></div>
            </div>
        </div>
    </div>

    <div id="modal-settings" class="modal hidden">
        <div class="modal-content card">
            <h2 style="margin-bottom: 16px;">Settings</h2>
            <div class="input-group">
                <label for="input-sbp">Base Systolic BP (mmHg)</label>
                <input type="number" id="input-sbp" value="120">
            </div>
            <button id="btn-save-settings" class="btn" style="width: 100%; background: var(--accent);">Save & Close</button>
        </div>
    </div>

    <script>
        const tabSimple = document.getElementById('tab-simple');
        const tabAdvanced = document.getElementById('tab-advanced');
        const viewSimple = document.getElementById('view-simple');
        const viewAdvanced = document.getElementById('view-advanced');
        const btnSettings = document.getElementById('btn-settings');
        const modalSettings = document.getElementById('modal-settings');
        const btnSaveSettings = document.getElementById('btn-save-settings');
        const inputSbp = document.getElementById('input-sbp');

        let sbp = parseInt(localStorage.getItem('sbp')) || 120;
        inputSbp.value = sbp;

        tabSimple.onclick = () => { tabSimple.classList.add('active'); tabAdvanced.classList.remove('active'); viewSimple.classList.remove('hidden'); viewAdvanced.classList.add('hidden'); };
        tabAdvanced.onclick = () => { tabAdvanced.classList.add('active'); tabSimple.classList.remove('active'); viewAdvanced.classList.remove('hidden'); viewSimple.classList.add('hidden'); };
        btnSettings.onclick = () => modalSettings.classList.remove('hidden');
        btnSaveSettings.onclick = () => { sbp = parseInt(inputSbp.value) || 120; localStorage.setItem('sbp', sbp); modalSettings.classList.add('hidden'); };

        function calculateAltitude(p) { return p <= 0 ? 0 : 44330 * (1 - Math.pow(p / 1013.25, 0.1903)); }
        function calculateExpectedSpO2(h) { return 99.042 - 0.001 * h; }
        function calculatePaO2(spo2) {
            let s = spo2 / 100.0;
            if (s >= 1.0) s = 0.9999;
            if (s <= 0.0) return 0;
            let A = (11700 * s) / (1 - s);
            return Math.cbrt(Math.sqrt(503 + A * A) + A) - Math.cbrt(Math.sqrt(503 + A * A) - A);
        }
        function calculateSystemicShock(hr, spo2, sbpVal) { return (sbpVal <= 0 || spo2 <= 0) ? 0 : hr / (sbpVal * spo2); }

        function evaluateLogic(hr, spo2, p, co2, dp, sbpVal, errMask) {
            if (errMask > 0) {
                let list = [];
                if (errMask & 1) list.push("BMP388");
                if (errMask & 2) list.push("SCD41");
                if (errMask & 4) list.push("MAX30102");
                return { type: 'ОШИБКА', text: 'Не обнаружены датчики на шине I2C: ' + list.join(', '), color: 'red' };
            }
            if (spo2 > 0 && (spo2 < 50 || spo2 > 100 || hr < 30 || hr > 220)) {
                return { type: 'ОШИБКА', text: 'Датчик пульса смещен. Поправьте его на пальце.', color: 'red' };
            }
            
            let ss = calculateSystemicShock(hr, spo2, sbpVal);
            if (ss >= 0.011 && spo2 > 0 && spo2 < 90) {
                return { type: 'ПРИКАЗ', text: 'Критическое кардио-респираторное напряжение! Немедленно присядьте и позовите на помощь.', color: 'red' };
            }
            
            if (p > 950) {
                if (spo2 > 0 && spo2 < 90) return { type: 'ПРИКАЗ', text: 'Тяжелая гипоксия! Срочно обратитесь к врачу.', color: 'red' };
                if (spo2 >= 90 && spo2 < 95) return { type: 'ВНИМАНИЕ', text: 'Легкая гипоксия. Расправьте спину, сделайте глубокие вдохи.', color: 'orange' };
            } else if (p > 0) {
                let h = calculateAltitude(p);
                let exp = calculateExpectedSpO2(h);
                if (spo2 > 0 && (spo2 < exp - 5 || spo2 < 80)) return { type: 'ПРИКАЗ', text: 'Риск горной болезни! Немедленно начните спуск.', color: 'red' };
                if (spo2 >= exp - 5 && spo2 < exp - 2) return { type: 'ВНИМАНИЕ', text: `Высотная гипоксия на ${Math.round(h)}м. Сделайте привал.`, color: 'orange' };
            }
            
            if (co2 >= 2000) return { type: 'ПРИКАЗ', text: 'Опасная душная среда! Выйдите на свежий воздух.', color: 'red' };
            if (co2 >= 1200) return { type: 'ВНИМАНИЕ', text: 'Высокая концентрация CO2. Немедленно откройте окно!', color: 'orange' };
            if (co2 >= 800) return { type: 'СОВЕТ', text: 'Воздух становится несвежим. Проветрите комнату.', color: 'yellow' };
            
            return { type: 'СОВЕТ', text: 'Воздух свежий. Показатели организма в норме.', color: 'green' };
        }

        async function updateData() {
            try {
                let res = await fetch('/data');
                let data = await res.json();
                
                let hrVal = data.hr;
                if (hrVal === -1) {
                    document.getElementById('val-hr').innerText = 'Calc...';
                } else {
                    document.getElementById('val-hr').innerText = hrVal || '--';
                }

                let spo2Val = data.spo2;
                if (spo2Val === -1) {
                    document.getElementById('val-spo2').innerText = 'Calc...';
                } else {
                    document.getElementById('val-spo2').innerText = spo2Val || '--';
                }

                document.getElementById('val-co2').innerText = data.co2 || '--';
                document.getElementById('val-p').innerText = data.p ? data.p.toFixed(1) : '--';

                let h = calculateAltitude(data.p);
                document.getElementById('val-h').innerText = data.p > 0 ? Math.round(h) : '--';
                document.getElementById('val-spo2-exp').innerText = data.p > 0 ? calculateExpectedSpO2(h).toFixed(1) : '--';
                
                // Only compute derived metrics if we have a valid non-negative reading
                document.getElementById('val-pao2').innerText = data.spo2 > 0 ? calculatePaO2(data.spo2).toFixed(1) : '--';
                document.getElementById('val-ss').innerText = (data.spo2 > 0 && data.hr > 0) ? calculateSystemicShock(data.hr, data.spo2, sbp).toFixed(4) : '--';

                let advice = evaluateLogic(data.hr, data.spo2, data.p, data.co2, 0.0, sbp, data.e);
                document.getElementById('alert-type').innerText = advice.type;
                document.getElementById('alert-text').innerText = advice.text;
                document.getElementById('alert-card').className = 'card alert-card ' + advice.color;
            } catch(e) {
                console.error("Fetch error", e);
            }
        }
        setInterval(updateData, 1000);
        updateData();
    </script>
</body>
</html>
"""

# ==========================================
# WEB SERVER LOOP (Production Mode)
# ==========================================
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(('', 80))
s.listen(5)
s.setblocking(False)

print("Pico W Server started. Connect to Wi-Fi 'Pico-Sensor-Hub' and open http://192.168.4.1/")

while True:
    # Update pulse sensor (20Hz sampling)
    max_sensor.update()

    try:
        conn, addr = s.accept()
        try:
            conn.setblocking(True)
            request = conn.recv(1024).decode('utf-8')
            
            if "GET /data" in request:
                hr, spo2 = max_sensor.read()
                p = bmp.read()
                co2 = scd.read()
                
                res_data = {
                    "hr": hr,
                    "spo2": spo2,
                    "p": p,
                    "co2": co2,
                    "e": err_mask
                }
                conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n')
                conn.sendall(json.dumps(res_data).encode('utf-8'))
            else:
                conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n')
                conn.sendall(HTML_CONTENT.encode('utf-8'))
        except:
            pass
        finally:
            conn.close()
    except OSError:
        time.sleep(0.05) # Delay to match 20Hz sample rate

// docs.js — Algorithm & Signal Processing Specification (embedded HTML)
// Displayed via the Settings → "View Algorithm Spec" button.

const ALGORITHM_SPEC_HTML = `
<div class="docs-header">
  <h1>Algorithm Specification</h1>
  <p class="docs-subtitle">Health Monitoring Wearable — Firmware / WebApp</p>
  <div class="docs-meta">
    <span>Seeed Studio XIAO nRF52840</span>
    <span>·</span>
    <span>MAX30102 · BMP388 · SCD41</span>
    <span>·</span>
    <span>v1.x, 2026-07-21</span>
  </div>
</div>

<section>
  <h2><span class="section-num">1</span>Oximetry — SpO₂ &amp; Heart Rate (MAX30102)</h2>

  <h3>1.1 Sensor Configuration</h3>
  <table>
    <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Operating mode</td><td>SpO₂ (Red + IR)</td></tr>
      <tr><td>LED current</td><td>≈ 6.4 mA (reg 0x1F)</td></tr>
      <tr><td>ADC resolution</td><td>18-bit (full scale 4 096)</td></tr>
      <tr><td>Sample rate</td><td>100 Hz</td></tr>
      <tr><td>Pulse width</td><td>411 µs</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Maxim Integrated. <em>MAX30102 Data Sheet.</em> Rev 3, 2018.
    <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf" target="_blank" rel="noopener">analog.com ↗</a>
  </p>

  <h3>1.2 SpO₂ Algorithm — Maxim Reference</h3>
  <p>The firmware uses <strong>Maxim Integrated's reference algorithm</strong> (<code>maxim_heart_rate_and_oxygen_saturation</code>) supplied with the SparkFun MAX3010x library. It operates on a rolling 100-sample buffer (1 s at 100 Hz). After each full buffer, the last 25 samples are kept and 25 new ones are appended (sliding window, 4 Hz update).</p>

  <h3>1.3 Validity Criteria</h3>
  <table>
    <thead><tr><th>Parameter</th><th>Accepted Range</th><th>Rationale</th></tr></thead>
    <tbody>
      <tr><td>SpO₂</td><td>51 – 100 %</td><td>≤ 50 % is physiologically implausible without cardiac arrest</td></tr>
      <tr><td>Heart Rate</td><td>31 – 219 bpm</td><td>WHO range (60–100) extended for athletes / tachycardia</td></tr>
      <tr><td>IR (finger ON)</td><td>&gt; 25 000 counts</td><td rowspan="2">Hysteresis — prevents state flickering at signal boundary</td></tr>
      <tr><td>IR (finger OFF)</td><td>&lt; 15 000 counts</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Maxim AN-6409. <em>Recommended Configurations and Measurement Performance of the MAX30101/MAX30102 EV Kits.</em> 2018.
    <a href="https://www.maximintegrated.com/en/design/technical-documents/app-notes/6/6409.html" target="_blank" rel="noopener">maximintegrated.com ↗</a>
  </p>
</section>

<section>
  <h2><span class="section-num">2</span>Barometric Pressure &amp; Altitude (BMP388)</h2>

  <h3>2.1 Sensor Configuration</h3>
  <table>
    <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Temperature oversampling</td><td>8×</td></tr>
      <tr><td>Pressure oversampling</td><td>4×</td></tr>
      <tr><td>IIR filter coefficient</td><td>3</td></tr>
      <tr><td>Output data rate</td><td>50 Hz</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Bosch Sensortec. <em>BMP388 Data Sheet.</em> Rev 1.6, 2020.
    <a href="https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp388-ds001.pdf" target="_blank" rel="noopener">bosch-sensortec.com ↗</a>
  </p>

  <h3>2.2 Altitude Calculation (ISA Standard Atmosphere)</h3>
  <div class="formula-block">h = 44 330 × [1 − (P / 1013.25)<sup>0.1903</sup>]</div>
  <p>where P₀ = 1013.25 hPa and the exponent = 1 / 5.255 ≈ 0.1903.</p>
  <p class="ref">▸ ICAO. <em>Manual of the ICAO Standard Atmosphere.</em> Doc 7488/3, 3rd ed., 1993.<br>
     ▸ ISO 2533:1975 — Standard Atmosphere.
  </p>

  <h3>2.3 3-Hour Pressure Trend (ΔP)</h3>
  <p>Pressure is sampled every minute into a 180-sample circular ring buffer (3 h). ΔP = P<sub>current</sub> − P<sub>oldest</sub>. A drop ≥ 5 hPa / 3 h is flagged as a barometric headache risk.</p>
  <p class="ref">▸ Ng TP et al. <em>The effects of barometric pressure on migraine.</em> Cephalalgia, 2007.</p>
</section>

<section>
  <h2><span class="section-num">3</span>CO₂ Level (SCD41)</h2>
  <table>
    <thead><tr><th>Principle</th><th>Interval</th><th>Range</th><th>Accuracy</th></tr></thead>
    <tbody>
      <tr><td>NDIR</td><td>5 s (periodic)</td><td>400 – 40 000 ppm</td><td>±40 ppm ± 5 %</td></tr>
    </tbody>
  </table>
  <h3>Alert Thresholds</h3>
  <table>
    <thead><tr><th>Range (ppm)</th><th>Level</th><th>Action</th></tr></thead>
    <tbody>
      <tr><td>&lt; 800</td><td class="tag green">Normal</td><td>Fresh air</td></tr>
      <tr><td>800 – 1 199</td><td class="tag yellow">Advisory</td><td>Ventilate room</td></tr>
      <tr><td>1 200 – 1 999</td><td class="tag orange">Warning</td><td>Open windows immediately; cognitive impairment begins</td></tr>
      <tr><td>≥ 2 000</td><td class="tag red">Critical</td><td>Leave area; risk of headache, fatigue, impaired judgement</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Sensirion. <em>SCD40 / SCD41 Data Sheet.</em> v1.7, 2022.
    <a href="https://sensirion.com/media/documents/48C4B7FB/64C134E7/Sensirion_SCD4x_Datasheet.pdf" target="_blank" rel="noopener">sensirion.com ↗</a><br>
    ▸ ASHRAE. <em>Standard 62.1-2022 — Ventilation and Acceptable Indoor Air Quality.</em><br>
    ▸ NIOSH Pocket Guide — Carbon Dioxide.
    <a href="https://www.cdc.gov/niosh/npg/npgd0103.html" target="_blank" rel="noopener">cdc.gov ↗</a>
  </p>
</section>

<section>
  <h2><span class="section-num">4</span>Battery State of Charge — Piecewise-Linear LiPo Model</h2>
  <p>Voltage is sampled via a ÷2 voltage divider + 12-bit ADC. SoC is estimated by <strong>11-point piecewise-linear interpolation</strong> through the LiPo discharge curve (0.5 C rate), which corrects the up-to-20 % overstatement inherent in a single linear approximation.</p>
  <table>
    <thead><tr><th>Voltage (V)</th><th>SoC (%)</th></tr></thead>
    <tbody>
      <tr><td>4.20</td><td>100</td></tr>
      <tr><td>4.06</td><td>90</td></tr>
      <tr><td>3.98</td><td>80</td></tr>
      <tr><td>3.86</td><td>70</td></tr>
      <tr><td>3.78</td><td>60</td></tr>
      <tr><td>3.71</td><td>50</td></tr>
      <tr><td>3.63</td><td>40</td></tr>
      <tr><td>3.54</td><td>30</td></tr>
      <tr><td>3.45</td><td>20</td></tr>
      <tr><td>3.35</td><td>10</td></tr>
      <tr><td>3.20</td><td>0</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Bergveld HJ. <em>Battery Management Systems — Design by Modelling.</em> Philips Research, 2001.<br>
     ▸ Plett GL. <em>Battery Management Systems, Vol. 1.</em> Artech House, 2015.
  </p>
</section>

<section>
  <h2><span class="section-num">5</span>Expected SpO₂ at Altitude — Physiological Model</h2>
  <p>A <strong>non-linear physiological model</strong> is used, not a linear fit. Blood oxygen saturation follows the sigmoid oxyhemoglobin dissociation curve (ODC). Input: barometric pressure P (hPa). Output: expected SaO₂ (%) for a healthy adult at rest.</p>

  <h3>Processing Chain</h3>

  <div class="step-block">
    <div class="step-label">Step 1 — PiO₂ (Inspired Partial Pressure of O₂)</div>
    <div class="formula-block">PiO₂ = (P<sub>baro,mmHg</sub> − 47) × 0.2093</div>
    <p>47 mmHg = saturated water vapour at 37 °C &nbsp;|&nbsp; 0.2093 = FiO₂ &nbsp;|&nbsp; 1 hPa = 0.750062 mmHg</p>
  </div>

  <div class="step-block">
    <div class="step-label">Step 2 — PAO₂ (Alveolar O₂) — Simplified Alveolar Gas Equation</div>
    <div class="formula-block">PAO₂ = PiO₂ − PaCO₂ / 0.8</div>
    <p>RQ = 0.8 (respiratory quotient at rest). PaCO₂ decreases with altitude via the hypoxic ventilatory response:</p>
    <div class="formula-block">PaCO₂ = max(15,&nbsp; 40 × P / 1013.25) mmHg</div>
  </div>

  <div class="step-block">
    <div class="step-label">Step 3 — PaO₂ (Arterial O₂)</div>
    <div class="formula-block">PaO₂ = PAO₂ − 5 mmHg</div>
    <p>5 mmHg = normal alveolar-arterial (A–a) gradient in healthy adults at rest.</p>
  </div>

  <div class="step-block">
    <div class="step-label">Step 4 — SaO₂ — Severinghaus (1979) ODC</div>
    <div class="formula-block">SaO₂ = 1 / [ 23 400 / (PaO₂³ + 150·PaO₂) + 1 ]</div>
    <p>Output clamped to [70 %, 99 %].</p>
  </div>

  <h3>Validation Against Published Data</h3>
  <table>
    <thead><tr><th>Altitude</th><th>Pressure (hPa)</th><th>Model</th><th>Published¹</th><th>Error</th></tr></thead>
    <tbody>
      <tr><td>0 m (sea level)</td><td>1013</td><td>97.3 %</td><td>97–99 %</td><td>&lt; 1 %</td></tr>
      <tr><td>1 500 m</td><td>845</td><td>95.1 %</td><td>95–97 %</td><td>&lt; 1 %</td></tr>
      <tr><td>3 000 m</td><td>701</td><td>90.9 %</td><td>90–93 %</td><td>&lt; 1 %</td></tr>
      <tr><td>5 000 m</td><td>540</td><td>78.9 %</td><td>79–82 %</td><td>&lt; 2 %</td></tr>
    </tbody>
  </table>
  <p style="font-size:12px;color:var(--text-muted);">¹ Acclimatised healthy adults, resting. Source: West (2007), Hackett &amp; Roach (2001).</p>
  <p class="ref">
    ▸ <strong>Severinghaus JW.</strong> Simple, accurate equations for human blood O₂ dissociation computations. <em>J Appl Physiol.</em> 1979;46(3):599–602.
    <a href="https://pubmed.ncbi.nlm.nih.gov/35496/" target="_blank" rel="noopener">PubMed ↗</a><br>
    ▸ <strong>West JB, Schoene RB, Milledge JS.</strong> <em>High Altitude Medicine and Physiology.</em> 4th ed. Chapman &amp; Hall, 2007. ISBN 978-0340913408.<br>
    ▸ <strong>West JB.</strong> <em>Respiratory Physiology: The Essentials.</em> 10th ed. Wolters Kluwer, 2016. ISBN 978-1496310118.<br>
    ▸ <strong>Hackett PH, Roach RC.</strong> High-altitude illness. <em>N Engl J Med.</em> 2001;345(2):107–114.
    <a href="https://doi.org/10.1056/NEJM200107123450206" target="_blank" rel="noopener">DOI ↗</a>
  </p>
</section>

<section>
  <h2><span class="section-num">6</span>PaO₂ from SpO₂ — Inverse Severinghaus Equation</h2>
  <p>Arterial PO₂ (PaO₂) is derived from measured SpO₂ by inverting the Severinghaus equation via <strong>Cardano's formula</strong> for the depressed cubic:</p>
  <div class="formula-block">PaO₂³ + 150·PaO₂ − 23 400·s / (1 − s) = 0 &nbsp;&nbsp; where s = SpO₂ / 100</div>
  <p>Output clamped to <strong>[0, 150] mmHg</strong> (normal arterial range: 80–100 mmHg).</p>
  <p class="ref">▸ Severinghaus JW. <em>J Appl Physiol.</em> 1979;46(3):599–602.</p>
</section>

<section>
  <h2><span class="section-num">7</span>Altitude Threshold — 845 hPa ≈ 1 500 m</h2>
  <p>The logic engine switches from sea-level to altitude physiological scenarios at <strong>845 hPa (≈ 1 500 m)</strong> — the WHO-defined lower boundary at which barometric hypoxia produces clinically relevant effects in healthy individuals.</p>
  <p class="ref">
    ▸ WHO. <em>International Travel and Health.</em> Chapter 3. WHO Press, 2012.<br>
    ▸ Luks AM et al. WMS practice guidelines for prevention and treatment of acute altitude illness: 2014 update. <em>Wilderness Environ Med.</em> 2014;25(4 Suppl):S4–S14.
    <a href="https://doi.org/10.1016/j.wem.2014.06.017" target="_blank" rel="noopener">DOI ↗</a>
  </p>
</section>

<section>
  <h2><span class="section-num">8</span>Systemic Shock Index (Composite Cardiorespiratory Metric)</h2>
  <div class="formula-block">SS = HR / (SBP × SpO₂)</div>
  <p>Combines the classical <strong>Allgöwer Shock Index</strong> (HR / SBP) with SpO₂ to simultaneously capture haemodynamic instability and hypoxaemia.</p>
  <table>
    <thead><tr><th>State</th><th>Typical SS</th></tr></thead>
    <tbody>
      <tr><td>Healthy at rest (HR 70, SBP 120, SpO₂ 98 %)</td><td>≈ 0.0060</td></tr>
      <tr><td>Mild stress (HR 90, SBP 120, SpO₂ 95 %)</td><td>≈ 0.0079</td></tr>
      <tr><td><strong>Alert threshold</strong></td><td><strong>≥ 0.0110</strong></td></tr>
      <tr><td>Severe distress (HR 130, SBP 80, SpO₂ 85 %)</td><td>≈ 0.0191</td></tr>
    </tbody>
  </table>
  <p class="ref">▸ Allgöwer M, Burri C. Schockindex. <em>Dtsch Med Wochenschr.</em> 1967;92(43):1947–1950.
    <a href="https://doi.org/10.1055/s-0028-1106070" target="_blank" rel="noopener">DOI ↗</a>
  </p>
</section>

<section class="disclaimer">
  <h2>⚠️ Disclaimer</h2>
  <p>This device is a <strong>personal wellness monitor</strong> and is <strong>not a certified medical device</strong>. It does not comply with IEC 60601 or ISO 80601-2-61 (pulse oximetry) standards. All readings are for recreational and informational use only. Do not use for clinical diagnosis or treatment. In any medical emergency, contact emergency services immediately.</p>
</section>
`;

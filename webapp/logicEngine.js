// logicEngine.js

function evaluateLogic(hr, spo2, p, co2, dp, sbp) {
    // Quality Checks
    if (spo2 > 0 && (spo2 < 50 || spo2 > 100 || hr < 30 || hr > 220)) {
        return { type: 'ОШИБКА', text: 'Датчик пульсоксиметра смещен. Поправьте устройство на пальце/запястье.', color: 'red' };
    }
    if (co2 > 0 && (co2 < 350 || co2 > 10000)) {
        return { type: 'ОШИБКА', text: 'Сбой датчика CO2. Требуется калибровка на свежем воздухе.', color: 'red' };
    }
    if (p > 0 && (p < 300 || p > 1100)) {
        return { type: 'ОШИБКА', text: 'Показания барометра вне допустимого диапазона.', color: 'red' };
    }

    let result = { type: 'СОВЕТ', text: 'Подключено. Идет сбор данных...', color: 'default' };
    let riskLevel = 0; // 0=none, 1=low, 2=med, 3=crit
    
    let ss = calculateSystemicShock(hr, spo2, sbp);
    
    // 1. Critical cardio-respiratory check
    if (ss >= 0.011 && spo2 > 0 && spo2 < 90) {
        return { type: 'ПРИКАЗ', text: 'Опасное кардио-респираторное напряжение! Немедленно присядьте, отдохните и вызовите помощь.', color: 'red' };
    }
    
    // 2. Oxygen & Altitude checks
    if (p > 950) { // Sea level
        if (spo2 > 0 && spo2 < 90) {
            return { type: 'ПРИКАЗ', text: 'Тяжелая гипоксемия! Срочно вызовите врача или обеспечьте подачу кислорода.', color: 'red' };
        } else if (spo2 >= 90 && spo2 < 95) {
            if (riskLevel < 2) {
                result = { type: 'ВНИМАНИЕ', text: 'Легкая тканевая гипоксия. Расправьте спину и сделайте несколько глубоких вдохов.', color: 'orange' };
                riskLevel = 2;
            }
        } else if (spo2 >= 95) {
            if (riskLevel < 1) {
                result = { type: 'СОВЕТ', text: 'Кислородный баланс организма в норме.', color: 'green' };
            }
        }
    } else if (p > 0 && p <= 950) { // Altitude
        let h = calculateAltitude(p);
        let expSpo2 = calculateExpectedSpO2(h);
        if (spo2 > 0 && (spo2 < expSpo2 - 5 || spo2 < 80)) {
            return { type: 'ПРИКАЗ', text: 'Риск острой горной болезни! Прекратите восхождение и немедленно начните контролируемый спуск вниз.', color: 'red' };
        } else if (spo2 >= expSpo2 - 5 && spo2 < expSpo2 - 2) {
            if (riskLevel < 2) {
                result = { type: 'ВНИМАНИЕ', text: `Высотная гипоксия на ${Math.round(h)} метрах. Сделайте привал, пейте больше воды, не поднимайтесь выше сегодня.`, color: 'orange' };
                riskLevel = 2;
            }
        } else if (spo2 >= expSpo2 - 2) {
            if (riskLevel < 1) {
                result = { type: 'СОВЕТ', text: `Отличная адаптация на высоте ${Math.round(h)} метров. Можете продолжать восхождение в умеренном темпе.`, color: 'green' };
            }
        }
    }
    
    // 3. CO2 checks (independent of altitude)
    if (co2 >= 2000) {
        if (riskLevel < 3) return { type: 'ПРИКАЗ', text: 'Опасная душная среда! Риск головной боли. Откройте окна настежь или выйдите на воздух.', color: 'red' };
    } else if (co2 >= 1200) {
        if (riskLevel < 2) {
            result = { type: 'ВНИМАНИЕ', text: 'Снижение концентрации и внимания. Немедленно откройте окно!', color: 'orange' };
            riskLevel = 2;
        }
    } else if (co2 >= 800) {
        if (riskLevel < 1) {
            result = { type: 'СОВЕТ', text: 'Воздух становится несвежим. Рекомендуется слегка проветрить помещение.', color: 'yellow' };
            riskLevel = 1;
        }
    } else if (co2 > 0 && co2 < 800) {
        if (riskLevel === 0) { 
            result = { type: 'СОВЕТ', text: 'Воздух свежий. Качество окружающей среды отличное.', color: 'green' };
        }
    }
    
    // 4. Pressure drops
    if (dp <= -5 && p > 0) {
        if (riskLevel < 1) {
            result = { type: 'СОВЕТ', text: 'Быстрое падение атмосферного давления. Риск барометрической головной боли. Избегайте кофеина.', color: 'yellow' };
            riskLevel = 1;
        }
    }
    
    return result;
}

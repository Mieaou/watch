// logicEngine.js

function evaluateLogic(hr, spo2, p, co2, dp, sbp, errMask = 0) {
    // Hardware Errors - Keep hardcoded as they are fundamental device state
    if (errMask > 0) {
        let offlineList = [];
        if (errMask & 1) offlineList.push("Барометр BMP388");
        if (errMask & 2) offlineList.push("Датчик CO2 SCD41");
        if (errMask & 4) offlineList.push("Пульсоксиметр MAX30102");
        return { type: 'ОШИБКА', text: `Не обнаружены датчики на шине I2C: ${offlineList.join(', ')}. Проверьте подключение/питание!`, color: 'red' };
    }

    // Quality Checks - Keep hardcoded as they are fundamental sensor validity
    if (spo2 > 0 && (spo2 < 50 || spo2 > 100 || hr < 30 || hr > 220)) {
        return { type: 'ОШИБКА', text: 'Датчик пульсоксиметра смещен. Поправьте устройство на пальце/запястье.', color: 'red' };
    }
    if (co2 > 0 && (co2 < 350 || co2 > 10000)) {
        return { type: 'ОШИБКА', text: 'Сбой датчика CO2. Требуется калибровка на свежем воздухе.', color: 'red' };
    }
    if (p > 0 && (p < 300 || p > 1100)) {
        return { type: 'ОШИБКА', text: 'Показания барометра вне допустимого диапазона.', color: 'red' };
    }

    let defaultResult = { type: 'СОВЕТ', text: 'Подключено. Идет сбор данных...', color: 'default' };
    
    // Prepare data context for scenarios
    let h = 0, expSpo2 = 0, ss = 0;
    if (p > 0) {
        h = calculateAltitude(p);
        // calculateExpectedSpO2 takes barometric pressure directly (hPa)
        expSpo2 = calculateExpectedSpO2(p);
    }
    if (hr > 0 && spo2 > 0 && sbp > 0) {
        ss = calculateSystemicShock(hr, spo2, sbp);
    }

    const dataContext = {
        hr, spo2, p, co2, dp, sbp, h, expSpo2, ss
    };

    let highestPriority = -1;
    let selectedResult = null;

    // Helper to evaluate a category of scenarios
    const evaluateCategory = (category) => {
        if (!category) return;
        for (let rule of category) {
            if (rule.condition(dataContext)) {
                if (rule.priority > highestPriority) {
                    highestPriority = rule.priority;
                    selectedResult = typeof rule.result === 'function' ? rule.result(dataContext) : rule.result;
                }
            }
        }
    };

    // Evaluate all categories
    evaluateCategory(scenarios.cardio);
    
    // Altitude threshold: 845 hPa ≈ 1500 m — WHO-defined lower boundary
    // for clinically significant hypobaric hypoxia effects.
    if (p > 845) {
        evaluateCategory(scenarios.seaLevel);
    } else if (p > 0 && p <= 845) {
        evaluateCategory(scenarios.altitude);
    }
    
    evaluateCategory(scenarios.co2);
    evaluateCategory(scenarios.pressureDrops);

    return selectedResult || defaultResult;
}

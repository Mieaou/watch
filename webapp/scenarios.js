// scenarios.js
// Глобальный объект для хранения сценариев (правил) логического движка

const scenarios = {
    // Кардио-респираторные сценарии
    cardio: [
        {
            id: 'critical_shock',
            condition: (data) => data.ss >= 0.011 && data.spo2 > 0 && data.spo2 < 90,
            result: { type: 'ПРИКАЗ', text: 'Опасное кардио-респираторное напряжение! Немедленно присядьте, отдохните и вызовите помощь.', color: 'red' },
            priority: 100
        }
    ],

    // Сценарии уровня моря (Давление > 950 hPa)
    seaLevel: [
        {
            id: 'hypoxemia_severe',
            condition: (data) => data.spo2 > 0 && data.spo2 < 90,
            result: { type: 'ПРИКАЗ', text: 'Тяжелая гипоксемия! Срочно вызовите врача или обеспечьте подачу кислорода.', color: 'red' },
            priority: 90
        },
        {
            id: 'hypoxemia_mild',
            condition: (data) => data.spo2 >= 90 && data.spo2 < 95,
            result: { type: 'ВНИМАНИЕ', text: 'Легкая тканевая гипоксия. Расправьте спину и сделайте несколько глубоких вдохов.', color: 'orange' },
            priority: 50
        },
        {
            id: 'oxygen_normal',
            condition: (data) => data.spo2 >= 95,
            result: { type: 'СОВЕТ', text: 'Кислородный баланс организма в норме.', color: 'green' },
            priority: 10
        }
    ],

    // Высотные сценарии (Давление <= 950 hPa)
    altitude: [
        {
            id: 'ams_risk',
            condition: (data) => data.spo2 > 0 && (data.spo2 < data.expSpo2 - 5 || data.spo2 < 80),
            result: { type: 'ПРИКАЗ', text: 'Риск острой горной болезни! Прекратите восхождение и немедленно начните контролируемый спуск вниз.', color: 'red' },
            priority: 90
        },
        {
            id: 'altitude_hypoxia',
            condition: (data) => data.spo2 >= data.expSpo2 - 5 && data.spo2 < data.expSpo2 - 2,
            result: (data) => ({ type: 'ВНИМАНИЕ', text: `Высотная гипоксия на ${Math.round(data.h)} метрах. Сделайте привал, пейте больше воды, не поднимайтесь выше сегодня.`, color: 'orange' }),
            priority: 50
        },
        {
            id: 'altitude_adapted',
            condition: (data) => data.spo2 >= data.expSpo2 - 2,
            result: (data) => ({ type: 'СОВЕТ', text: `Отличная адаптация на высоте ${Math.round(data.h)} метров. Можете продолжать восхождение в умеренном темпе.`, color: 'green' }),
            priority: 10
        }
    ],

    // Сценарии CO2
    co2: [
        {
            id: 'co2_critical',
            condition: (data) => data.co2 >= 2000,
            result: { type: 'ПРИКАЗ', text: 'Опасная душная среда! Риск головной боли. Откройте окна настежь или выйдите на воздух.', color: 'red' },
            priority: 80
        },
        {
            id: 'co2_warning',
            condition: (data) => data.co2 >= 1200,
            result: { type: 'ВНИМАНИЕ', text: 'Снижение концентрации и внимания. Немедленно откройте окно!', color: 'orange' },
            priority: 40
        },
        {
            id: 'co2_stuffy',
            condition: (data) => data.co2 >= 800,
            result: { type: 'СОВЕТ', text: 'Воздух становится несвежим. Рекомендуется слегка проветрить помещение.', color: 'yellow' },
            priority: 20
        },
        {
            id: 'co2_fresh',
            condition: (data) => data.co2 > 0 && data.co2 < 800,
            result: { type: 'СОВЕТ', text: 'Воздух свежий. Качество окружающей среды отличное.', color: 'green' },
            priority: 10
        }
    ],

    // Сценарии резкого изменения давления
    pressureDrops: [
        {
            id: 'dp_drop',
            condition: (data) => data.dp <= -5 && data.p > 0,
            result: { type: 'СОВЕТ', text: 'Быстрое падение атмосферного давления. Риск барометрической головной боли. Избегайте кофеина.', color: 'yellow' },
            priority: 30
        }
    ]
};

// Справочник параметров для кнопок "i"
const parameterInfo = {
    hr: {
        title: "Heart Rate (ЧСС)",
        description: "Частота сердечных сокращений. В норме у взрослого человека в покое составляет от 60 до 100 ударов в минуту."
    },
    spo2: {
        title: "SpO2 (Сатурация)",
        description: "Уровень насыщения крови кислородом. Здоровый показатель на уровне моря составляет 95-100%. На высоте он естественно снижается."
    },
    co2: {
        title: "CO2 Level",
        description: "Уровень углекислого газа в окружающей среде. На свежем воздухе около 400-450 ppm. Значения выше 1000 ppm указывают на необходимость проветривания."
    },
    p: {
        title: "Pressure (Давление)",
        description: "Атмосферное давление. На уровне моря стандартное давление составляет около 1013 hPa."
    },
    h: {
        title: "Altitude (Высота)",
        description: "Расчетная высота над уровнем моря, вычисленная на основе атмосферного давления."
    },
    spo2_exp: {
        title: "Expected SpO2",
        description: "Ожидаемый уровень сатурации для вашей текущей высоты над уровнем моря. Помогает оценить адаптацию к высоте."
    },
    pao2: {
        title: "PaO2",
        description: "Парциальное давление кислорода в артериальной крови, расчетный показатель для оценки эффективности дыхания."
    },
    ss: {
        title: "Systemic Shock (SS)",
        description: "Индекс кардио-респираторного напряжения. Чем выше значение, тем тяжелее организму справляться с текущей нагрузкой/гипоксией."
    },
    dp: {
        title: "ΔP (3 hours)",
        description: "Изменение атмосферного давления за последние 3 часа. Резкое падение может предвещать ухудшение погоды и вызывать головную боль."
    }
};

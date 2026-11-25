import type { QuestionTranslations } from './types';

// Traduções EN/ES das questões padrão embarcadas (nomes próprios e números de telefone ficam como estão).
export const DEFAULT_QUESTION_TRANSLATIONS: Record<number, QuestionTranslations> = {
  1: {
    en: {
      text: 'What does the acronym Caesb stand for?',
      options: [
        'Brasília Water and Sewage Company',
        'Federal District Environmental Sanitation Company',
        'Brasília Water Supply and Sanitation Company',
        'Water and Basic Sanitation Center',
      ],
    },
    es: {
      text: '¿Qué significa la sigla Caesb?',
      options: [
        'Compañía de Aguas y Alcantarillado de Brasilia',
        'Compañía de Saneamiento Ambiental del Distrito Federal',
        'Compañía de Abastecimiento y Saneamiento de Brasilia',
        'Centro de Aguas y Saneamiento Básico',
      ],
    },
  },
  2: {
    en: {
      text: 'What is the main service Caesb provides to the population of the Federal District?',
      options: [
        'Garbage and solid waste collection',
        'Electricity supply',
        'Drinking water supply and sewage collection and treatment',
        'Public transportation',
      ],
    },
    es: {
      text: '¿Cuál es el principal servicio que presta Caesb a la población del Distrito Federal?',
      options: [
        'Recolección de basura y residuos sólidos',
        'Suministro de energía eléctrica',
        'Suministro de agua potable y recolección y tratamiento de aguas residuales',
        'Transporte público',
      ],
    },
  },
  3: {
    en: {
      text: 'What is the name of the famous artificial lake in Brasília that is also one of Caesb’s water sources?',
      options: ['Loch Ness', 'Swan Lake', 'Lake Paranoá', 'Rodrigo de Freitas Lagoon'],
    },
    es: {
      text: '¿Cómo se llama el famoso lago artificial de Brasilia, que también es una de las fuentes de agua de Caesb?',
      options: ['Lago Ness', 'Lago de los Cisnes', 'Lago Paranoá', 'Laguna Rodrigo de Freitas'],
    },
  },
  4: {
    en: {
      text: 'Does Caesb serve only the Federal District?',
      options: [
        'Yes, exclusively',
        'No, it also serves some cities around it in Goiás',
        'No, it serves all of Brazil',
        'No, it serves only the Pilot Plan',
      ],
    },
    es: {
      text: '¿Caesb atiende solamente al Distrito Federal?',
      options: [
        'Sí, exclusivamente',
        'No, también atiende algunas ciudades vecinas de Goiás',
        'No, atiende a todo Brasil',
        'No, atiende solamente el Plano Piloto',
      ],
    },
  },
  5: {
    en: {
      text: 'Caesb uses a bus called “Expresso Ambiental”. What is the goal of this project?',
      options: [
        'To transport company employees',
        'To read water meters',
        'To bring environmental education about the sanitation cycle to the community',
        'To clean septic tanks',
      ],
    },
    es: {
      text: 'Caesb utiliza un autobús llamado “Expresso Ambiental”. ¿Cuál es el objetivo de este proyecto?',
      options: [
        'Transportar a los empleados de la empresa',
        'Realizar la lectura de los medidores de agua',
        'Llevar educación ambiental sobre el ciclo del saneamiento a la comunidad',
        'Limpiar las fosas sépticas',
      ],
    },
  },
  6: {
    en: {
      text: 'What is the phone number of Caesb’s Customer Service Center for requesting services or reporting leaks?',
      options: ['190', '193', '115', '100'],
    },
    es: {
      text: '¿Cuál es el número de teléfono de la Central de Atención de Caesb para solicitar servicios o informar sobre fugas?',
      options: ['190', '193', '115', '100'],
    },
  },
  7: {
    en: {
      text: 'What are the names of the two largest water reservoirs in the Federal District, managed by Caesb?',
      options: [
        'Lake Paranoá and Lagoa Bonita',
        'Descoberto and Santa Maria',
        'Corumbá IV and Serra da Mesa',
        'Itumbiara and Emborcação',
      ],
    },
    es: {
      text: '¿Cómo se llaman los dos mayores embalses de agua del Distrito Federal, gestionados por Caesb?',
      options: [
        'Lago Paranoá y Lagoa Bonita',
        'Descoberto y Santa Maria',
        'Corumbá IV y Serra da Mesa',
        'Itumbiara y Emborcação',
      ],
    },
  },
  8: {
    en: {
      text: 'What is the “sewage sludge” generated at wastewater treatment plants, and what is its main sustainable destination promoted by Caesb?',
      options: [
        'It is toxic waste discarded in landfills',
        'It is a nutrient-rich material that, after treatment, is used as fertilizer in agriculture',
        'It is burned to generate energy',
        'It is returned to rivers untreated',
      ],
    },
    es: {
      text: '¿Qué es el “lodo de depuradora” generado en las plantas de tratamiento de aguas residuales y cuál es su principal destino sostenible promovido por Caesb?',
      options: [
        'Es un residuo tóxico desechado en rellenos sanitarios',
        'Es un material rico en nutrientes que, tras su tratamiento, se utiliza como fertilizante en la agricultura',
        'Se quema para generar energía',
        'Se devuelve a los ríos sin tratamiento',
      ],
    },
  },
  9: {
    en: {
      text: 'Besides chlorine, what other advanced disinfection technology does Caesb use at the Lago Norte water treatment plant?',
      options: ['Gamma rays', 'Ozone', 'Ultrafiltration membranes', 'Beach sand filtration'],
    },
    es: {
      text: 'Además del cloro, ¿qué otra tecnología avanzada de desinfección utiliza Caesb en la planta de tratamiento de Lago Norte?',
      options: ['Rayos gamma', 'Ozono', 'Membranas de ultrafiltración', 'Filtración con arena de playa'],
    },
  },
  10: {
    en: {
      text: 'Which of the following actions does NOT contribute to conscious water use?',
      options: [
        'Taking shorter showers',
        'Always running the washing machine at full capacity',
        'Washing the sidewalk with a hose',
        'Fixing leaks quickly',
      ],
    },
    es: {
      text: '¿Cuál de las siguientes acciones NO contribuye al consumo consciente del agua?',
      options: [
        'Ducharse menos tiempo',
        'Usar la lavadora siempre a plena capacidad',
        'Lavar la acera con manguera',
        'Reparar las fugas rápidamente',
      ],
    },
  },
  11: {
    en: {
      text: 'Which main river gives its name to the largest water production system in the Federal District, responsible for about 60% of the supply?',
      options: ['São Francisco River', 'Paranoá River', 'Descoberto River', 'Tocantins River'],
    },
    es: {
      text: '¿Qué río principal da nombre al mayor sistema productor de agua del Distrito Federal, responsable de cerca del 60% del abastecimiento?',
      options: ['Río São Francisco', 'Río Paranoá', 'Río Descoberto', 'Río Tocantins'],
    },
  },
  12: {
    en: {
      text: 'What is the name of the Caesb program that aims to regularize water connections in areas of social vulnerability?',
      options: ['Water for All', 'Legal Water', 'Citizen Connection', 'Sanitize Brasília'],
    },
    es: {
      text: '¿Cómo se llama el programa de Caesb que busca regularizar las conexiones de agua en áreas de vulnerabilidad social?',
      options: ['Agua para Todos', 'Agua Legal', 'Conexión Ciudadana', 'Sanear Brasilia'],
    },
  },
};

// Original foundation notes and examples. Source links establish curriculum context,
// not a claim that these questions are official examination questions.
export const ol = [
  [
    "math-algebra",
    "Mathematics: algebra and number",
    ["Mathematics"],
    "ගණිතය கணிதம் algebra fractions",
    [
      [
        "How do I solve 3x + 5 = 20?",
        "Subtract 5 from both sides to obtain 3x = 15, then divide both sides by 3: x = 5. Check by substitution: 3(5) + 5 = 20. Performing the same operation on both sides preserves equality.",
      ],
      [
        "How do I factorise x² + 5x + 6?",
        "Find two numbers whose product is 6 and sum is 5: 2 and 3. Therefore x² + 5x + 6 = (x + 2)(x + 3). Expanding the factors gives the original expression; this is a useful check.",
      ],
      [
        "How do I add 2/3 and 3/4?",
        "Use the common denominator 12. Then 2/3 = 8/12 and 3/4 = 9/12, so their sum is 17/12 = 1 5/12. Do not add denominators. Estimate first: both fractions are near one, so an answer greater than one is sensible.",
      ],
      [
        "A book costs LKR 800 before a 15% discount. What is the sale price?",
        "The discount is 0.15 × 800 = LKR 120. The sale price is 800 − 120 = LKR 680. Alternatively multiply 800 by 0.85. A discount percentage applies to the stated original price, not the discounted price.",
      ],
      [
        "How do I solve x + y = 7 and x − y = 1?",
        "Add the equations to eliminate y: 2x = 8, so x = 4. Substitute into x + y = 7 to find y = 3. Check both equations. Elimination works because adding equal quantities produces another valid equality.",
      ],
      [
        "What restrictions matter when simplifying (x² − 9)/(x − 3)?",
        "Factor the numerator as (x − 3)(x + 3), then cancel the common factor only when x ≠ 3. The simplified expression is x + 3 with the original restriction x ≠ 3. Cancelling does not make the original expression defined at x = 3.",
      ],
    ],
  ],
  [
    "math-geometry",
    "Mathematics: geometry and measurement",
    ["Mathematics"],
    "ගණිතය கணிதம் geometry angles area",
    [
      [
        "Two angles of a triangle are 50° and 60°. Find the third angle.",
        "The interior angles of a plane triangle sum to 180°. The third angle is 180° − 50° − 60° = 70°. State the angle-sum property rather than writing only the final number.",
      ],
      [
        "A right triangle has perpendicular sides 6 cm and 8 cm. Find its hypotenuse.",
        "By Pythagoras, c² = 6² + 8² = 36 + 64 = 100, so c = 10 cm. The hypotenuse is opposite the right angle. This formula applies directly only to right triangles.",
      ],
      [
        "How do area and volume change when all lengths are doubled?",
        "For similar shapes, multiplying each length by k multiplies area by k² and volume by k³. Doubling lengths therefore gives four times the area and eight times the volume. Similarity is essential: changing only one dimension does not obey this whole-shape rule.",
      ],
      [
        "Find the area of a circle of radius 7 cm using π = 22/7.",
        "Area = πr² = (22/7) × 7² = 154 cm². The radius is half the diameter. Use the value of π specified in the question, and distinguish area in square units from circumference in length units.",
      ],
      [
        "How do I find a missing side using trigonometry?",
        "In a right triangle, sin θ = opposite/hypotenuse, cos θ = adjacent/hypotenuse, and tan θ = opposite/adjacent. Label sides relative to the chosen angle, select the ratio containing the known and unknown sides, rearrange, and check the calculator angle mode.",
      ],
      [
        "A cylinder has radius 3 cm and height 10 cm. What is its volume?",
        "Volume = πr²h = π × 9 × 10 = 90π cm³. Volume measures occupied three-dimensional space. If measurements are given in different units, convert them before using the formula.",
      ],
    ],
  ],
  [
    "math-statistics",
    "Mathematics: statistics and probability",
    ["Mathematics"],
    "ගණිතය கணிதம் statistics probability",
    [
      [
        "Find the mean, median and mode of 2, 3, 3, 4, 8.",
        "The sum is 20, so mean = 20/5 = 4. The ordered middle value is 3, so median = 3. The most frequent value is 3, so mode = 3. The large value 8 pulls the mean above the median.",
      ],
      [
        "What is the probability of an even result on a fair six-sided die?",
        "The equally likely outcomes are 1 to 6. The favourable outcomes are 2, 4 and 6, giving 3/6 = 1/2. Counting favourable outcomes over total outcomes requires equally likely elementary outcomes.",
      ],
      [
        "Two fair coins are tossed independently. What is P(two heads)?",
        "The equally likely outcomes are HH, HT, TH and TT, so P(HH) = 1/4. Equivalently, independence gives (1/2)(1/2) = 1/4. Do not treat the descriptions 'two heads', 'one head' and 'no heads' as equally likely.",
      ],
      [
        "What does a cumulative-frequency graph show?",
        "It gives the number of observations at or below successive boundaries. To estimate a median, locate half the total frequency on the frequency axis and read the corresponding value. Interpolation gives an estimate, not the exact original observation.",
      ],
      [
        "What is the difference between a sample and a population?",
        "The population is the full group of interest; a sample is the subset actually studied. A large but biased sample can still misrepresent the population. Explain who was included and how they were selected before drawing conclusions.",
      ],
      [
        "Can a correlation prove that one variable causes another?",
        "No. Correlation describes association. A third variable, reverse causation or coincidence may explain the pattern. Use the graph to describe the relationship, but require a suitable investigation and supporting evidence before claiming causation.",
      ],
    ],
  ],
  [
    "science-physics",
    "Science: forces, energy and electricity",
    ["Science"],
    "විද්‍යාව அறிவியல் force electricity energy",
    [
      [
        "A 2 kg object accelerates at 3 m s⁻². Find the resultant force.",
        "Newton's second law gives F = ma = 2 × 3 = 6 N. This is the resultant force, not necessarily one of several individual forces. A force diagram helps distinguish weight, reaction, friction and applied forces.",
      ],
      [
        "What is the difference between mass and weight?",
        "Mass measures inertia and is expressed in kilograms. Weight is gravitational force: W = mg, expressed in newtons. If a question specifies g = 10 m s⁻², a 5 kg object's weight is 50 N. Do not assume a value of g when the question supplies another.",
      ],
      [
        "A 12 V supply is connected across a 6 Ω resistor. Find the current.",
        "For an ohmic resistor at constant physical conditions, V = IR. Hence I = V/R = 12/6 = 2 A. Real components can change resistance with temperature, so the straight-line relation is not universal for every device.",
      ],
      [
        "What happens to current and voltage in a series circuit?",
        "A single unbranched path has the same current through each component. The supply potential difference is shared across components. Total resistance of series resistors is R₁ + R₂ + … . Draw the circuit before applying these rules.",
      ],
      [
        "A 60 W lamp operates for 5 hours. How much electrical energy does it use?",
        "Energy = power × time = 0.060 kW × 5 h = 0.30 kWh. The kilowatt-hour is an energy unit, not a power unit. A money cost additionally requires the relevant tariff, which must be checked rather than assumed.",
      ],
      [
        "Why does an object appear bent at a water surface?",
        "Light changes direction when crossing between media with different refractive indices at an oblique angle. The eye traces the emerging ray backwards in a straight line, producing an apparent displaced position. This is refraction, not bending of the object itself.",
      ],
    ],
  ],
  [
    "science-chemistry",
    "Science: atoms, reactions and materials",
    ["Science"],
    "විද්‍යාව அறிவியல் chemistry atoms acids",
    [
      [
        "How are an element, a compound and a mixture different?",
        "An element contains one type of atom. A compound has elements chemically combined in fixed proportions. A mixture contains substances physically combined in variable proportions. Separation methods depend on whether chemical bonds must be broken.",
      ],
      [
        "How do I balance H₂ + O₂ → H₂O?",
        "Use coefficients: 2H₂ + O₂ → 2H₂O. Both sides then have four hydrogen atoms and two oxygen atoms. Change coefficients, not the subscripts inside chemical formulas, because changing a subscript changes the substance.",
      ],
      [
        "What do proton number and mass number represent?",
        "Proton number is the number of protons. Mass number is protons plus neutrons for a particular isotope. For a neutral atom, electrons equal protons. An ion differs in electron number, not in proton number.",
      ],
      [
        "How does pH distinguish common aqueous solutions?",
        "At approximately 25°C, neutral water has pH 7; acidic solutions have lower pH and alkaline solutions higher pH. pH is logarithmic. A universal-indicator colour gives an approximate range, not a high-precision measurement.",
      ],
      [
        "Why can a metal react with an acid to produce a gas?",
        "Certain sufficiently reactive metals displace hydrogen from dilute non-oxidising acids, forming a salt and hydrogen. The result depends on the metal and acid; it is not true for every metal-acid pair. Laboratory tests need teacher supervision.",
      ],
      [
        "How do physical and chemical changes differ?",
        "A physical change alters form or state without changing chemical identity, such as melting ice. A chemical change forms different substances, such as iron rusting. Colour or temperature changes are clues, but identify the substances and evidence before deciding.",
      ],
    ],
  ],
  [
    "science-biology",
    "Science: cells, plants and the human body",
    ["Science"],
    "විද්‍යාව அறிவியல் biology cells photosynthesis",
    [
      [
        "How do plant and animal cells differ?",
        "Typical plant cells have a cellulose cell wall, and photosynthetic plant cells have chloroplasts. Plant cells commonly have a large central vacuole. Animal cells lack cellulose walls and chloroplasts. Both have a cell membrane, cytoplasm and, in typical eukaryotic cells, a nucleus.",
      ],
      [
        "What is photosynthesis?",
        "Photosynthetic organisms use light energy to synthesise organic molecules from carbon dioxide and water. The school-level word equation is carbon dioxide + water → glucose + oxygen, with light and chlorophyll indicated as conditions. Roots do not absorb ready-made plant food from soil.",
      ],
      [
        "How are breathing and cellular respiration different?",
        "Breathing moves air into and out of lungs. Cellular respiration is a sequence of metabolic reactions that releases usable energy from organic molecules. In aerobic respiration oxygen is used; gas exchange supports the process but is not the same process.",
      ],
      [
        "What is an ecosystem?",
        "An ecosystem includes living organisms and their non-living environment interacting in an area. In a food chain, arrows represent transfer of energy from a food source to its consumer. Matter cycles, whereas energy is progressively dissipated, mainly as heat.",
      ],
      [
        "What does a food web show that a single food chain misses?",
        "A food web represents multiple feeding relationships. An organism can have several food sources and predators. Changes in one population may have indirect effects elsewhere, so avoid predicting an ecosystem's response from one arrow alone.",
      ],
      [
        "How do I design a fair investigation of plant growth?",
        "Change one independent variable, measure a defined dependent variable, control other important conditions, use replication and record the time period. For example, compare light levels while keeping plant type, soil, watering and initial size as similar as practicable.",
      ],
    ],
  ],
  [
    "sinhala",
    "Sinhala language and literature",
    ["Sinhala Language & Literature"],
    "සිංහල භාෂාව සාහිත්‍යය சிங்களம்",
    [
      [
        "How do I plan a Sinhala essay without memorising a whole answer?",
        "Identify the task, audience and required form. Draft a central idea, three supporting points and a conclusion, then write coherent paragraphs with examples. Check register, spelling and sentence agreement using the prescribed textbook and teacher feedback.",
      ],
      [
        "What should a literature answer do besides retell the story?",
        "Make a focused claim about character, theme, language or structure. Refer to a specific incident or a short accurately remembered phrase, then explain how it supports the claim. Plot summary alone rarely demonstrates interpretation.",
      ],
      [
        "How do I write a useful summary of a Sinhala passage?",
        "Read for the central message, identify indispensable supporting ideas and remove repetition and examples that are not essential. Rewrite in your own words within the stated limit. Do not add opinions or facts that the passage does not contain.",
      ],
      [
        "How can I distinguish a simile from a metaphor?",
        "A simile explicitly compares using a comparison expression, while a metaphor presents one thing as another. In either case explain the shared quality and its effect in context. Naming the device without interpreting the wording is incomplete.",
      ],
      [
        "What belongs in a formal letter?",
        "Use the layout required by the task: sender and recipient details where appropriate, date, salutation, clear purpose, organised body and suitable close. Keep formal register consistent. Avoid inserting real private addresses into public practice datasets.",
      ],
      [
        "How should I revise unfamiliar Sinhala vocabulary?",
        "Record the word in a sentence, its contextual meaning, a synonym where appropriate and a sentence of your own. Test recognition and use on later days. A dictionary meaning may not match the literary meaning in a particular passage.",
      ],
    ],
  ],
  [
    "tamil",
    "Tamil language and literature",
    ["Tamil Language & Literature", "Second Language Tamil"],
    "தமிழ் மொழி இலக்கியம் දෙමළ",
    [
      [
        "How do I prepare a Tamil reading-comprehension answer?",
        "Identify the question word, locate the relevant passage and answer only what is asked. Preserve the passage's meaning while using your own wording where required. Distinguish information stated directly from an inference supported by clues.",
      ],
      [
        "What is a good method for practising Tamil writing?",
        "Begin with short meaningful sentences, check tense and agreement, and combine them into a paragraph with a clear topic. Use the register required by the task. Ask a Tamil teacher to review spelling and forms rather than treating machine translation as a marking scheme.",
      ],
      [
        "How can I discuss a Tamil poem?",
        "Identify the speaker, situation and central concern. Select specific images or sounds, explain their effects and connect them to the poem's development. Do not assume the speaker is the poet or that every image has one fixed universal meaning.",
      ],
      [
        "How should I learn new Tamil words?",
        "Keep the Tamil script, pronunciation guidance from a reliable source, meaning in context and an original example. Revise by recalling the word before revealing the answer. Transliteration can support beginners but should not replace reading the script.",
      ],
      [
        "How do I avoid copying a passage when writing a summary?",
        "List the essential propositions, set the original aside and reconstruct a shorter coherent version. Compare it with the source to check accuracy. Preserve cause, contrast and sequence rather than merely replacing a few words with synonyms.",
      ],
      [
        "Why does context matter when translating Tamil and English?",
        "A word can have several meanings, and politeness, tense and cultural context affect the best translation. Translate the intended message rather than each word mechanically. For an examination, follow the prescribed syllabus and the exact task instructions.",
      ],
    ],
  ],
  [
    "english",
    "English language: grammar and communication",
    ["English"],
    "English ඉංග්‍රීසි ஆங்கிலம் grammar writing",
    [
      [
        "Which is correct: she go or she goes?",
        "In the simple present affirmative, a third-person singular subject normally takes the -s form: she goes. Compare 'they go'. With an auxiliary, use the base form: 'Does she go?' Avoid adding -s to both the auxiliary and main verb.",
      ],
      [
        "How do I change 'The teacher marked the papers' into the passive?",
        "Write 'The papers were marked by the teacher.' The object becomes the subject; preserve the past tense with 'were' and use the past participle 'marked'. The agent phrase can be omitted if it is unnecessary.",
      ],
      [
        "What is the difference between since and for in time expressions?",
        "Use 'since' for a starting point, such as 'since Monday', and 'for' for a duration, such as 'for three days'. Both often occur with perfect tenses, but the complete sentence determines the correct tense.",
      ],
      [
        "How can I structure an examination email?",
        "Include a relevant subject line if requested, a suitable greeting, a clear purpose, the required details and a polite close. Match the level of formality to the recipient. Check that every content point in the prompt has been addressed.",
      ],
      [
        "What is an inference in a reading question?",
        "An inference is a conclusion supported by textual evidence but not necessarily stated word for word. Explain the clue and the conclusion. Do not replace an evidence-based inference with a personal guess unrelated to the passage.",
      ],
      [
        "How can I improve a paragraph?",
        "Give it a controlling idea, supporting explanation or evidence, and a logical link between sentences. Remove repetition and unclear pronouns. A paragraph should develop a point rather than become a list of disconnected memorised sentences.",
      ],
    ],
  ],
  [
    "history",
    "History: Sri Lanka and historical reasoning",
    ["History"],
    "ඉතිහාසය வரலாறு history Sri Lanka",
    [
      [
        "What is the difference between a primary and a secondary historical source?",
        "A primary source is evidence produced in or close to the period being studied, such as an inscription or contemporary letter. A secondary source interprets evidence later. Classification depends on the research question: a modern textbook can be primary evidence for studying modern education.",
      ],
      [
        "How do I explain a historical cause?",
        "Identify the event and explain the mechanism connecting a factor to it. Distinguish long-term conditions from immediate triggers and support each point with relevant evidence. A chronological list alone does not explain why an event occurred.",
      ],
      [
        "What date marks Sri Lanka's independence from British rule?",
        "Independence was achieved on 4 February 1948. Distinguish this from the establishment of the republic on 22 May 1972. When answering a broader question, explain the political changes and context rather than relying on dates alone.",
      ],
      [
        "How should I use an inscription as historical evidence?",
        "Consider its location, date, language, author or patron, purpose and surviving condition. Ask what it directly supports and what it cannot establish. Cross-check with other evidence; a ruler's public claim is not automatically a neutral account.",
      ],
      [
        "How do change and continuity differ?",
        "Change concerns what became different across a period. Continuity concerns what persisted. A strong comparison specifies the aspect, such as irrigation, administration or trade, and gives evidence from both time periods.",
      ],
      [
        "What is anachronism?",
        "Anachronism places something in an inappropriate historical period, such as explaining an ancient event using institutions that did not yet exist. Use the vocabulary and conditions relevant to the period, and be cautious about judging past choices only through present assumptions.",
      ],
    ],
  ],
  [
    "geography",
    "Geography: maps, climate and settlements",
    ["Geography"],
    "භූගෝල විද්‍යාව புவியியல் geography maps",
    [
      [
        "A map scale is 1:50,000. What ground distance is 4 cm?",
        "One centimetre represents 50,000 cm = 500 m. Four centimetres therefore represent 2,000 m = 2 km. State whether a measured line is straight-line distance or an estimated distance along a winding route.",
      ],
      [
        "How are weather and climate different?",
        "Weather describes atmospheric conditions over short periods. Climate describes patterns and statistics over longer periods. One unusually wet day does not establish a climate trend; use an appropriate time series and location.",
      ],
      [
        "Why can relief influence rainfall?",
        "Moist air forced to rise over higher ground can cool and condense, producing rainfall on the windward side. Descending air on the leeward side can be drier. Actual rainfall also depends on wind direction, moisture supply and seasonal circulation.",
      ],
      [
        "What should I include when describing a population distribution map?",
        "Identify concentrations and sparse areas, refer to named locations and describe the scale or data year. Then explain possible physical and human factors. Do not confuse total population with population density.",
      ],
      [
        "How do I calculate population density?",
        "Density = population divided by area. If 20,000 people occupy 50 km², density = 400 people per km². This average does not mean that every square kilometre contains exactly 400 people.",
      ],
      [
        "How do erosion and deposition differ?",
        "Erosion removes material through agents such as flowing water, waves or wind. Deposition occurs when transported material is laid down. Explain the agent and conditions; transport itself is a related but distinct process.",
      ],
    ],
  ],
  [
    "civics",
    "Civic education and citizenship",
    ["Civic Education"],
    "පුරවැසි අධ්‍යාපනය குடியியல் civic democracy",
    [
      [
        "How do a right and a responsibility differ?",
        "A right is a protected entitlement or freedom within a relevant framework. A responsibility concerns conduct expected of people or institutions. Discuss both using an appropriate school or community example, and verify legal claims against current official texts.",
      ],
      [
        "What does rule of law mean in civic education?",
        "It is the principle that public power is exercised under law rather than arbitrary personal will, with institutions and people accountable within the legal system. This definition is a learning aid, not advice about a particular legal dispute.",
      ],
      [
        "How can students resolve a school disagreement constructively?",
        "Listen to each account, identify the disputed issue, separate evidence from assumptions and propose options that respect school rules and the people involved. If intimidation or harm is involved, seek a trusted teacher rather than trying to handle it alone.",
      ],
      [
        "What is the difference between an opinion and evidence?",
        "An opinion states a judgement or preference. Evidence is information that can support or challenge a claim. Opinions can be well supported, but a confident or widely shared opinion is not automatically evidence.",
      ],
      [
        "What makes community participation meaningful?",
        "Identify a real need, consult affected people, plan practical work, assign roles and evaluate the result. For example, a school waste-reduction project should measure the problem and the outcome rather than count publicity alone.",
      ],
      [
        "Why should I verify civic information before sharing it?",
        "An outdated notice or edited image can mislead people. Check the issuing institution, publication date, complete document and corrections. Avoid treating an anonymous social-media graphic as an official rule or election instruction.",
      ],
    ],
  ],
  [
    "business-accounting",
    "Business and accounting foundations",
    ["Business Studies & Accounting", "Entrepreneurship Studies"],
    "ව්‍යාපාර ගිණුම්කරණය வணிகம் கணக்கியல்",
    [
      [
        "What is the accounting equation?",
        "Assets = liabilities + equity. If a business has assets of LKR 120,000 and liabilities of LKR 45,000, equity is LKR 75,000. The equation describes the business entity, not automatically the owner's personal finances.",
      ],
      [
        "A shop buys goods for LKR 600 and sells them for LKR 900. What is gross profit?",
        "Gross profit on these goods is sales minus cost of goods sold: 900 − 600 = LKR 300. It is not necessarily net profit because other expenses may still have to be deducted.",
      ],
      [
        "How are a good and a service different?",
        "A good is a product such as a notebook; a service is an activity such as repairing a bicycle. A business can supply both. Explain the customer need being met rather than deciding that one category is inherently more valuable.",
      ],
      [
        "What is opportunity cost?",
        "It is the value of the next-best alternative forgone when a choice is made. If a student spends a free hour on one activity, the opportunity cost is the best alternative use of that hour, not every possible activity added together.",
      ],
      [
        "What should a simple business plan include?",
        "Identify the customer need, product or service, expected customers, costs, price, delivery method, risks and a way to test demand. Hypothetical school examples should be labelled as examples, not promises of income.",
      ],
      [
        "How are cash and profit different?",
        "Cash measures money received and paid; profit compares income with related expenses under the accounting basis used. A credit sale may increase profit before cash arrives, while buying equipment may use cash without being an immediate full expense.",
      ],
    ],
  ],
  [
    "ict",
    "ICT: computers, data and algorithms",
    ["Information & Communication Technology"],
    "ICT තොරතුරු තාක්ෂණය தகவல் தொழில்நுட்பம்",
    [
      [
        "What is the difference between hardware and software?",
        "Hardware is physical equipment, such as a keyboard or processor. Software consists of programs and related instructions or data. An operating system manages resources and provides services for applications.",
      ],
      [
        "Convert binary 1011 to decimal.",
        "Using place values 8, 4, 2 and 1, binary 1011 is 1×8 + 0×4 + 1×2 + 1×1 = 11. Binary uses base two; do not read the digits as the decimal number one thousand and eleven.",
      ],
      [
        "What is an algorithm?",
        "An algorithm is a finite, ordered set of steps for solving a problem. State inputs, processing and outputs clearly. Pseudocode is a way to describe the logic without committing to the exact syntax of a programming language.",
      ],
      [
        "How does a loop differ from a conditional?",
        "A conditional selects a path based on a test. A loop repeats a sequence while or until a condition is met, or for a defined number of iterations. A loop can contain conditionals, so the concepts are not opposites.",
      ],
      [
        "What makes a useful spreadsheet formula?",
        "A formula begins with = and can refer to cells, such as =B2*C2 for quantity times unit price. Relative references change when copied; an absolute reference such as $B$1 stays fixed. Check the copied formula and units, not just its displayed number.",
      ],
      [
        "How can I protect a school account?",
        "Use a unique password, enable multi-factor authentication when available and check unexpected links through the official service. Never share passwords or one-time codes. Do not put real classmates' private data into public exercises.",
      ],
    ],
  ],
  [
    "agriculture",
    "Agriculture, food technology and fisheries",
    ["Agriculture & Food Technology", "Fisheries & Food Technology"],
    "කෘෂිකර්මය விவசாயம் agriculture fisheries",
    [
      [
        "Why does soil texture matter for crop production?",
        "Texture describes the relative proportions of sand, silt and clay. It influences water retention, drainage and aeration. Texture is different from soil structure, and a suitable soil depends on the crop and growing conditions.",
      ],
      [
        "What does compost contribute to soil?",
        "Well-managed compost adds organic matter and can improve soil structure and water-holding properties. Nutrient content varies, so it is not a universal substitute for every nutrient requirement. Follow safe school procedures when handling organic waste.",
      ],
      [
        "What is crop rotation?",
        "It is growing different crops in a planned sequence on the same land. Suitable rotations can help manage pests, diseases and nutrient use. The benefit depends on the crops chosen and local conditions, not merely changing crop names each season.",
      ],
      [
        "How do preservation methods slow food spoilage?",
        "Methods such as drying, chilling or controlled heat treatment alter conditions needed by spoilage organisms or enzymes. Each method has limits. This pack explains principles; it does not provide a safety-validated home-canning or commercial processing protocol.",
      ],
      [
        "Why is dissolved oxygen important in aquaculture?",
        "Fish and other aerobic aquatic organisms need oxygen for respiration. Stocking density, temperature, organic waste and water movement can affect oxygen availability. Species-specific management should follow teacher or qualified technical guidance.",
      ],
      [
        "How can I investigate seed germination?",
        "Compare clearly defined treatments using similar viable seeds and replicates. Record the number germinated and timing, and control other conditions. Germination percentage = germinated seeds / seeds tested × 100; define the observation period.",
      ],
    ],
  ],
  [
    "health-pe",
    "Health and physical education",
    ["Health & Physical Education"],
    "සෞඛ්‍ය ශාරීරික අධ්‍යාපනය சுகாதாரம் விளையாட்டு",
    [
      [
        "What does a balanced diet mean in a school-health lesson?",
        "A balanced diet supplies appropriate energy and nutrients through varied foods. Needs differ with age, activity and health. Use food-based education and qualified advice for individual health concerns; this dataset does not prescribe supplements, medicines or a personal diet.",
      ],
      [
        "Why warm up before physical activity?",
        "A gradual warm-up prepares the body and provides a chance to rehearse movements. The suitable activity depends on the sport and participant. Pain, dizziness or illness should not be treated as something a student must simply push through.",
      ],
      [
        "How are aerobic endurance and muscular strength different?",
        "Aerobic endurance concerns sustaining activity using the body's oxygen-delivery systems. Muscular strength concerns the force a muscle or muscle group can produce. A fitness plan may develop both, using age-appropriate activity and supervision.",
      ],
      [
        "What is a fair way to organise a school team activity?",
        "Explain the rules, allocate accessible roles, respect differences in ability and judge performance consistently. Fair play includes honesty, respect for opponents and responding appropriately to unsafe conduct.",
      ],
      [
        "How can a student manage an overloaded revision day?",
        "Break the work into small achievable tasks, include breaks and maintain regular routines. If stress feels unmanageable or persists, speak with a trusted adult, teacher or qualified professional. A study app should support learning rather than diagnose a health condition.",
      ],
      [
        "How do I evaluate a health claim online?",
        "Check the author, evidence, date, conflicts of interest and whether reliable health authorities agree. Personal testimonials do not establish safety or effectiveness. Do not use an exam-revision answer as a substitute for individual clinical advice.",
      ],
    ],
  ],
  [
    "religions",
    "Religion: distinct traditions and respectful study",
    ["Buddhism", "Saivaneri", "Islam", "Christianity", "Catholicism"],
    "බුද්ධ ධර්මය ආගම சமயம் மதம்",
    [
      [
        "How should I choose the correct religious-studies context?",
        "First identify the examination subject and prescribed tradition. Buddhism, Saivaneri, Islam, Christianity and Catholicism are distinct school subjects or traditions; their texts and terminology should not be merged into one generic answer.",
      ],
      [
        "What are the Four Noble Truths in Buddhist study?",
        "In a concise introductory formulation they concern dukkha, its arising, its cessation and the path leading to cessation. Explain the terms using the prescribed text and teaching context; translating dukkha only as ordinary sadness can obscure its broader meaning.",
      ],
      [
        "What does the term dharma require a student to check?",
        "Its meaning varies across religious and philosophical contexts. In a Hindu or Buddhist discussion, identify the tradition, text and usage before defining it. Do not assume that a shared transliterated word has an identical meaning everywhere.",
      ],
      [
        "How should I approach a question on the Five Pillars of Islam?",
        "Use the prescribed terminology for testimony of faith, prayer, charity, fasting and pilgrimage, then explain the specific pillar asked about. A brief school summary does not replace detailed religious instruction or justify assumptions about every individual's practice.",
      ],
      [
        "How can I analyse a Christian parable in an examination?",
        "Identify its narrative context, central teaching and the details that support an interpretation. Use the prescribed Bible translation and syllabus. Distinguish an interpretation in a particular denomination from a statement claimed to describe all Christian traditions.",
      ],
      [
        "How should a comparison of religious ethics be written respectfully?",
        "Define the selected ideas within each tradition, support them with the prescribed material and compare the specific issue requested. Avoid ranking communities or attributing a belief to all adherents based only on a short classroom summary.",
      ],
    ],
  ],
  [
    "aesthetics",
    "Art, music, dance, drama and craft",
    [
      "Art",
      "Music (Oriental)",
      "Music (Carnatic)",
      "Music (Western)",
      "Dancing",
      "Drama & Theatre",
      "Art & Craft",
    ],
    "චිත්‍ර සංගීත නැටුම් නාට්‍ය கலை இசை நடனம்",
    [
      [
        "How do I analyse a visual composition?",
        "Describe line, shape, colour, value, texture, space and their relationships. Explain how contrast, balance or emphasis directs attention. Relate observations to the particular work rather than assuming that a colour always has one meaning.",
      ],
      [
        "How are rhythm and melody different?",
        "Rhythm organises durations and patterns in time; melody organises a sequence of pitches. They interact but are not interchangeable. Use the notation and terminology of the musical tradition being studied.",
      ],
      [
        "What does a 3/4 time signature indicate in common Western notation?",
        "The upper number indicates three beats per bar, and the lower number indicates a quarter-note beat unit. This explanation applies to that notation system and is not a definition of rhythmic systems in every musical tradition.",
      ],
      [
        "How can a dancer prepare a reflective practice note?",
        "Name the movement or sequence, describe posture, timing, spatial pattern and expressive intention, then note one correction and how it was tested. Tradition-specific technique needs instruction from a qualified teacher and appropriate physical supervision.",
      ],
      [
        "How are dramatic character and actor different?",
        "The character is the represented person or role in a dramatic work; the actor is the performer creating that role. Analyse choices in voice, movement and interaction with evidence from the production or prescribed text.",
      ],
      [
        "What makes a useful art or craft portfolio entry?",
        "Include the task, research references, original sketches, materials, design decisions, process and reflection. Credit reference images and distinguish an original work from a copy or study. Assess both the outcome and the learning process.",
      ],
    ],
  ],
  [
    "languages-literature",
    "Additional languages and literary appreciation",
    [
      "Second Language Sinhala",
      "Second Language Tamil",
      "Sinhala Literature",
      "Tamil Literature",
      "English Literature",
      "Arabic Literature",
      "Pali",
      "Sanskrit",
      "French",
      "German",
      "Hindi",
      "Japanese",
      "Korean",
      "Russian",
      "Chinese",
      "Arabic",
    ],
    "භාෂා සාහිත්‍ය மொழிகள் இலக்கியம் languages literature",
    [
      [
        "How do I choose resources for an additional-language subject?",
        "Identify the exact subject, examination year, script and prescribed syllabus. Some course catalogs include old and new syllabi together. Use the current subject instructions rather than assuming that a resource for one language course fits every examination.",
      ],
      [
        "How can I practise vocabulary efficiently?",
        "Record a word or phrase with meaning, grammatical role and an original sentence. Test recall in both directions and revisit errors after increasing intervals. Listening and pronunciation practice should use reliable recordings or teacher feedback.",
      ],
      [
        "How is literary analysis different from a personal reaction?",
        "A personal reaction describes how you feel. Analysis explains how language, structure, viewpoint and context create an effect, supported by evidence from the text. A strong response can include a judgement, but it must explain that judgement.",
      ],
      [
        "How should I quote a prescribed literary text?",
        "Use a short accurate quotation when needed, place it in context and explain its relevance. If exact wording is uncertain, refer accurately to the incident rather than inventing a quotation. This dataset does not reproduce prescribed books or poems.",
      ],
      [
        "How can I practise writing in an unfamiliar script?",
        "Learn character forms and sound relationships systematically, copy carefully, then produce words from recall and use them in meaningful sentences. Ask a teacher to check character formation. Romanised spellings are a temporary aid, not a replacement for script proficiency.",
      ],
      [
        "What is the difference between translation and transliteration?",
        "Translation conveys meaning in another language. Transliteration represents writing from one script using another script. A transliteration may help pronunciation but does not necessarily provide a translation or capture the sound perfectly.",
      ],
    ],
  ],
  [
    "practical-technical",
    "Practical subjects: design, home economics and media",
    [
      "Design & Construction Technology",
      "Design & Mechanical Technology",
      "Design, Electrical & Electronic Technology",
      "Home Economics",
      "Communication & Media Studies",
      "Electronic Writing & Shorthand",
    ],
    "තාක්ෂණ ගෘහ ආර්ථික මාධ්‍ය தொழில்நுட்பம் ஊடகம்",
    [
      [
        "What are the stages of a school design process?",
        "Define the need, investigate constraints, generate options, choose a justified design, make or model it, test against criteria and improve it. Keep records of decisions. A neat finished product alone does not explain whether the original need was met.",
      ],
      [
        "How do I use a scale drawing?",
        "Apply one consistent ratio to every relevant length and include units and dimensions. For a 1:20 drawing, a 2 m length is shown as 10 cm. Check whether the question asks for a plan, elevation, section or another view.",
      ],
      [
        "What is the difference between a hazard and a risk?",
        "A hazard is a potential source of harm. Risk considers the likelihood and consequences of harm in a particular situation. School workshop activities require the teacher's safety rules, appropriate equipment and supervision; a chat answer is not permission to use machinery or mains electricity.",
      ],
      [
        "How can a family budget be represented simply?",
        "List expected income, essential expenses, variable expenses and a planned saving amount for a defined period. For example, income of LKR 10,000 and total planned spending of LKR 8,500 leave LKR 1,500 before any unlisted costs. This is arithmetic practice, not a personalised financial plan.",
      ],
      [
        "How do I distinguish a news report from an advertisement?",
        "Check who created it, its purpose, sponsorship, evidence and calls to action. An advertisement aims to influence a response, often a purchase; a news report should be assessed for sourcing and accuracy. Format alone does not prove independence.",
      ],
      [
        "How should I practise electronic writing or shorthand?",
        "Use the prescribed system, practise accurate forms before speed and measure errors as well as output. Keep personal information out of practice files. Different shorthand systems use different conventions, so a generic invented symbol set would be misleading.",
      ],
    ],
  ],
];

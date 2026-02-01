// Database migration script for Brooklyn CDL ELDT Quiz Data
// This script migrates quiz data from JavaScript to PostgreSQL database

const db = require('./db');

// Complete quiz data extracted from index.html quizRegistry
const quizData = {
  1: { title: "Basic Operation", questions: [
    { q: "What must you do to successfully complete this course?", options: { a: "Finish all lessons with at least 80%", b: "Finish all lessons with at least 70%", c: "Finish all lessons with at least 85%" }, correct: "a" },
    { q: "Who is responsible for the safety of the load and vehicle?", options: { a: "The driver", b: "The loader", c: "The company" }, correct: "a" },
    { q: "Driving a commercial vehicle is a serious responsibility.", options: { a: "Because it involves safety of lives and cargo", b: "Because it requires following strict regulations", c: "Because it is just like driving a car", d: "Because it is optional" }, correct: "a" },
    { q: "FMCSRs and HMRs are…", options: { a: "Minimum safety standards for trucking", b: "Guidelines only for passenger cars", c: "Optional recommendations", d: "Rules only for state police" }, correct: "a" },
    { q: "Vehicle size and weight limits…", options: { a: "Are the same in every state", b: "Differ depending on the state", c: "Are set only by federal law", d: "Don't apply to commercial vehicles" }, correct: "b" },
    { q: "Why is a Pre-Trip inspection important?", options: { a: "To find defects that could cause accidents", b: "To make your boss happy", c: "It isn't important" }, correct: "a" },
    { q: "Checking oil level during Pre-Trip is important because…", options: { a: "It prevents engine damage", b: "It's required by law", c: "It saves fuel", d: "It's optional" }, correct: "a" },
    { q: "What is the minimum steer tire tread depth?", options: { a: "3/32\"", b: "2/32\"", c: "4/32\"" }, correct: "c" },
    { q: "If you notice unusual sounds, smells, or vibrations while driving, you should…", options: { a: "Continue driving normally", b: "Stop and check immediately", c: "Ignore them if minor", d: "Report only at the end of the trip" }, correct: "b" },
    { q: "Is the service brake a primary or secondary component?", options: { a: "Primary", b: "Secondary" }, correct: "a" },
    { q: "What does the voltage gauge show?", options: { a: "Operating voltage", b: "Fuel level", c: "Oil pressure" }, correct: "a" },
    { q: "If the ABS light stays on…", options: { a: "ABS is working properly", b: "ABS is not working properly", c: "ABS is optional equipment", d: "ABS only matters in rain" }, correct: "b" },
    { q: "How long should it take to build air pressure from 50–90 PSI?", options: { a: "1 minute", b: "3 minutes", c: "5 minutes" }, correct: "b" },
    { q: "How long should you hold the brake pedal when testing hydraulic brakes?", options: { a: "3 seconds", b: "5 seconds", c: "10 seconds" }, correct: "b" },
    { q: "Does pulling the trailer brake lever harder increase trailer braking force?", options: { a: "Yes", b: "No" }, correct: "b" },
    { q: "Adjusting seat and mirrors before driving ensures…", options: { a: "Maximum visibility", b: "Comfort only", c: "Faster driving", d: "Nothing important" }, correct: "a" },
    { q: "Keeping mirrors and the windshield clean helps prevent accidents.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "What is the most important thing to watch during turns?", options: { a: "Your phone", b: "The rear of your trailer", c: "Your shift pattern" }, correct: "b" },
    { q: "Low bridge signs…", options: { a: "Are always accurate", b: "May be inaccurate", c: "Apply only to cars", d: "Are optional to follow" }, correct: "b" },
    { q: "Was the bridge weight formula created to protect older bridges?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Backing should be avoided because…", options: { a: "It increases accident risk", b: "It wastes fuel", c: "It is illegal", d: "It is slower" }, correct: "a" },
    { q: "Does your starting position matter when backing?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should you get out and look (G.O.A.L.) before backing?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Blind side backing is more dangerous because…", options: { a: "Visibility is reduced", b: "It takes longer", c: "It damages tires", d: "It is illegal" }, correct: "a" },
    { q: "Is using a spotter helpful, even though you are still responsible?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "How far should you press the clutch when shifting a non-synced transmission?", options: { a: "To the floor", b: "2–3 inches", c: "Neither" }, correct: "b" },
    { q: "If you miss a gear, should you keep the clutch pressed down?", options: { a: "Yes, until you stop", b: "No, release and try again", c: "Only if downhill", d: "Only if uphill" }, correct: "b" },
    { q: "When downshifting a non-synced transmission, what RPM should you drop to before shifting to neutral?", options: { a: "1100", b: "900", c: "700" }, correct: "c" },
    { q: "Is proper shifting technique important to prevent equipment damage?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "On the interstate, you should…", options: { a: "Relax and stop paying attention", b: "Stay alert and scan ahead", c: "Drive faster than normal", d: "Ignore mirrors" }, correct: "b" },
    { q: "In tight areas, you should…", options: { a: "Always have an exit strategy", b: "Rely on luck", c: "Stop and wait", d: "Ignore surroundings" }, correct: "a" },
    { q: "When should you first inspect your cargo after starting your trip?", options: { a: "25 miles", b: "50 miles", c: "75 miles" }, correct: "b" },
    { q: "Do different rigs have different coupling/uncoupling procedures?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "What should you do before coupling?", options: { a: "Inspect the area and chock wheels", b: "Immediately back under the trailer", c: "Skip inspection" }, correct: "a" },
    { q: "When backing under a trailer, what should you do?", options: { a: "Use lowest reverse gear", b: "Back slowly", c: "Stop when kingpin locks", d: "All of the above" }, correct: "d" },
    { q: "Should you visually inspect the coupling to ensure it is secure?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Which lines must be checked for proper connection?", options: { a: "Electrical cord", b: "Air lines", c: "Both" }, correct: "c" },
    { q: "Why must you check trailer clearance after raising landing gear?", options: { a: "To avoid tractor–trailer damage", b: "To avoid landing gear catching during turns", c: "Both" }, correct: "c" },
    { q: "What is the final step after raising landing gear and checking clearance?", options: { a: "Remove wheel chocks", b: "Drive away immediately" }, correct: "a" },
    { q: "When uncoupling, what must you do before unlocking the fifth wheel?", options: { a: "Position the rig correctly", b: "Ease pressure on locking jaws", c: "Both" }, correct: "c" },
    { q: "Should you chock trailer wheels if it has no spring brakes?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should you keep your feet clear of tractor wheels when unlocking the fifth wheel?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should the tractor remain under the trailer until you confirm landing gear is stable?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should you secure the tractor before inspecting trailer supports?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "When inspecting trailer supports, what should you check?", options: { a: "Ground support", b: "Landing gear condition", c: "Both" }, correct: "c" },
    { q: "After confirming landing gear is stable, is it safe to pull the tractor away?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Wider vehicles…", options: { a: "Have less room for error", b: "Are easier to maneuver", c: "Require no special care", d: "Are exempt from rules" }, correct: "a" },
    { q: "Should you be 100% sure nothing is behind you before backing?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should you always use the lowest gear when backing?", options: { a: "Yes", b: "No" }, correct: "a" }
  ]},
  2: { title: "Safe Operating Procedures", questions: [
    { q: "You should always be aware of your surroundings when driving a CMV.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "How far ahead should you look when driving a CMV?", options: { a: "3–6 seconds", b: "7–10 seconds", c: "12–15 seconds" }, correct: "c" },
    { q: "Is it acceptable to drive without checking your mirrors regularly?", options: { a: "Yes", b: "No", c: "Only on straight, empty roads" }, correct: "b" },
    { q: "Objects in convex mirrors appear:", options: { a: "Closer than they are", b: "Further than they are", c: "The same as in flat mirrors" }, correct: "b" },
    { q: "When signaling a lane change, you should:", options: { a: "Signal and wait for traffic to clear before moving", b: "Signal and immediately move", c: "Not signal" }, correct: "a" },
    { q: "Is it acceptable to wave your hands out the window to direct traffic?", options: { a: "Yes", b: "No", c: "Only in emergencies" }, correct: "b" },
    { q: "Use headlights during the day when visibility is low.", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "How long do you have to place emergency warning devices after stopping?", options: { a: "5 minutes", b: "10 minutes", c: "As soon as possible" }, correct: "b" },
    { q: "On a two-way highway, the standard placement of warning devices is:", options: { a: "20 ft from vehicle and 200 ft ahead/behind", b: "10 ft from vehicle and 100 ft ahead/behind", c: "20 ft from vehicle and 100 ft ahead/behind" }, correct: "b" },
    { q: "If the view is obstructed, how far back should the last device be placed?", options: { a: "150 ft", b: "250 ft", c: "100–500 ft depending on obstruction" }, correct: "c" },
    { q: "Distracted driving is anything that takes your attention away from driving.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "If you are not focused while operating a CMV, the likely outcome is:", options: { a: "Minor inconvenience", b: "Injury or death to you or others", c: "No consequence" }, correct: "b" },
    { q: "Should you pull over before checking a mobile device?", options: { a: "Yes", b: "No", c: "Only if traffic is heavy" }, correct: "a" },
    { q: "To be a professional driver you must stay focused and avoid distractions.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Is it your responsibility to watch out for other distracted drivers?", options: { a: "Yes", b: "No", c: "Only in urban areas" }, correct: "a" },
    { q: "Perception distance is the distance your vehicle travels from seeing a hazard until you recognize it.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Average human reaction time to a hazard is about:", options: { a: "2–3 seconds", b: "1–2 seconds", c: "0.75–1 second", d: "Less than 0.5 second" }, correct: "c" },
    { q: "At 55 mph in ideal conditions, stopping distance is closest to:", options: { a: "220 feet", b: "319 feet", c: "419 feet" }, correct: "c" },
    { q: "By slowing down you can reduce braking distance.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Which requires greater stopping distance?", options: { a: "Empty vehicle", b: "Loaded vehicle", c: "Both the same" }, correct: "a" },
    { q: "A vehicle is tailgating you in bad weather. What should you do?", options: { a: "Speed up to keep traffic flowing", b: "Find a safe place to pull over and let them pass", c: "Brake-check them" }, correct: "b" },
    { q: "If you're not sure of road conditions, you should:", options: { a: "Slow down", b: "Maintain speed", c: "Speed up to clear the area" }, correct: "a" },
    { q: "Should you ever exceed the posted speed limit for a curve?", options: { a: "Yes, if you feel confident", b: "No", c: "Only if empty and light load" }, correct: "b" },
    { q: "If you must use low beams at night, should you reduce speed to allow more reaction time?", options: { a: "Yes", b: "No", c: "Only in heavy traffic" }, correct: "a" },
    { q: "Where trucks are required to go slower, be extra careful when changing lanes.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "On steep grades, you should be in a lower gear before starting the grade.", options: { a: "Yes", b: "No", c: "Only if heavy load" }, correct: "a" },
    { q: "Never speed in work zones.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Maintain space ahead – always watch the space in front of your vehicle.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "If you see brake lights ahead, you should:", options: { a: "Apply brakes early and smoothly", b: "Ignore them", c: "Swerve around" }, correct: "a" },
    { q: "For a 40ft vehicle at 50 mph in ideal conditions, recommended following distance is:", options: { a: "4 seconds", b: "5 seconds", c: "7 seconds" }, correct: "b" },
    { q: "Should you ever 'brake check' a tailgater?", options: { a: "No", b: "Yes", c: "Only in emergencies" }, correct: "a" },
    { q: "Staying centered in your lane helps avoid other traffic.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Checking mirrors to see your trailer helps you stay centered.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Is it safe to have smaller vehicles traveling next to you?", options: { a: "Yes", b: "No", c: "Only at low speed" }, correct: "b" },
    { q: "Can high winds push you out of your lane regardless of vehicle size?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "Should you assume posted overhead clearance heights are always correct?", options: { a: "Yes", b: "No", c: "Only on major highways" }, correct: "b" },
    { q: "Is the clearance under your vehicle important to monitor?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "When making turns, watch your trailer in the mirrors through the whole turn.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Before pulling into traffic, make sure traffic is clear and you have enough room.", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "If you feel sleepy while driving, the best cure is:", options: { a: "Roll windows down", b: "Turn music up", c: "Stop driving and sleep" }, correct: "c" },
    { q: "Before starting a trip, check coolant, heating/defrost, wipers and washer fluid.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Should you learn how to put chains on before you need them?", options: { a: "Yes", b: "No", c: "Only if you drive in snow regularly" }, correct: "a" },
    { q: "In bad weather, lack of spray from other vehicles may indicate ice on the road.", options: { a: "True", b: "False" }, correct: "a" },
    { q: "Should you brake in corners during inclement weather?", options: { a: "No", b: "Yes", c: "Only lightly" }, correct: "a" },
    { q: "Can water in the brakes cause them to become weak?", options: { a: "Yes", b: "No" }, correct: "a" },
    { q: "How often should you inspect tires in very hot weather?", options: { a: "Every 4 hours / 200 miles", b: "Every 2 hours / 100 miles", c: "Every 1 hour / 50 miles" }, correct: "b" }
  ]},
  3: { title: "Advanced Operating Practices", questions: [
    { q: "What is the best early action when you spot a potential hazard ahead?", options: { a: "Ignore it until it becomes urgent", b: "Slow down and plan an escape route", c: "Honk and maintain speed", d: "Speed up to pass quickly" }, correct: "b" },
    { q: "If you see a stopped emergency vehicle on the roadside, you should:", options: { a: "Maintain speed and lane", b: "Move over if safe or slow down", c: "Stop in the lane", d: "Flash lights and continue" }, correct: "b" },
    { q: "Which drivers are likely to create hazards you should watch for?", options: { a: "Drivers with blocked vision", b: "Pedestrians and bicyclists", c: "Drunk drivers and delivery trucks", d: "All of the above" }, correct: "d" },
    { q: "To be a prepared defensive driver you should:", options: { a: "Only watch the vehicle ahead", b: "Anticipate emergencies and make a plan", c: "Rely on other drivers to react", d: "Drive faster to avoid hazards" }, correct: "b" },
    { q: "If your trailer begins to jackknife, the correct immediate response is to:", options: { a: "Panic and stomp the brakes", b: "Remain calm and avoid overcorrection", c: "Turn the wheel sharply away from the trailer", d: "Accelerate to straighten out" }, correct: "b" },
    { q: "When you don't have time to stop, evasive steering is often faster than braking.", options: { a: "True", b: "False", c: "Only on dry pavement" }, correct: "a" },
    { q: "Which describes the stab braking method?", options: { a: "Pump the brakes continuously", b: "Apply brakes firmly without locking, then release if needed", c: "Fully apply and hold the brakes", d: "Use engine brake only" }, correct: "b" },
    { q: "Approach every railroad crossing expecting a train. What should you do first?", options: { a: "Speed up to cross quickly", b: "Slow, look, and listen for trains", c: "Shift gears while crossing", d: "Ignore signs if no lights" }, correct: "b" },
    { q: "Which vehicles are required to stop at public railroad crossings?", options: { a: "All commercial motor vehicles", b: "Vehicles carrying hazardous materials", c: "Passenger buses", d: "Both b and c" }, correct: "d" },
    { q: "If required to stop at a railroad crossing, how far from the nearest rail should you stop?", options: { a: "Between 10 and 45 feet", b: "Between 15 and 50 feet", c: "Directly on the rail", d: "More than 100 feet" }, correct: "b" },
    { q: "If your vehicle stalls on the tracks, what is the correct immediate action?", options: { a: "Stay inside and wait", b: "Get out and move away from the tracks, then call for help", c: "Try to push the vehicle off the tracks", d: "Signal other drivers to stop" }, correct: "b" },
    { q: "When a trailer starts to skid, which action helps regain control?", options: { a: "Brake hard and hold", b: "Steer into the skid and ease off the brakes", c: "Turn sharply away from the skid", d: "Shift to neutral and coast" }, correct: "b" },
    { q: "Which of these is a sign your brakes are fading?", options: { a: "A strong burning smell", b: "A spongy pedal and reduced braking power", c: "Brake pedal feels firm and responsive", d: "Both a and b" }, correct: "d" },
    { q: "If you must use evasive steering to avoid a crash, you should:", options: { a: "Oversteer aggressively", b: "Steer smoothly and avoid sudden overcorrections", c: "Let go of the wheel", d: "Brake and steer at the same time hard" }, correct: "b" },
    { q: "Jackknifing is most likely to occur when:", options: { a: "Trailer brakes lock and tractor keeps moving", b: "You accelerate on a straight road", c: "You use cruise control downhill", d: "Trailer is empty" }, correct: "a" },
    { q: "If your trailer begins to swing out, you should:", options: { a: "Speed up to straighten it", b: "Slow gradually and avoid abrupt steering", c: "Brake hard immediately", d: "Shift to neutral and coast" }, correct: "b" },
    { q: "When approaching a work zone, the safest approach is to:", options: { a: "Maintain speed and lane", b: "Slow down, watch for workers, and follow signs", c: "Weave through traffic to pass quickly", d: "Stop in the lane" }, correct: "b" },
    { q: "If you must leave the roadway to avoid a crash, you should:", options: { a: "Swerve sharply at high speed", b: "Slow as much as possible and steer smoothly off the road", c: "Jump the curb", d: "Brake and hold while turning hard" }, correct: "b" },
    { q: "When a skid begins, pumping the brakes is recommended only if you do not have ABS.", options: { a: "True", b: "False", c: "Only on wet roads" }, correct: "a" },
    { q: "Which of the following helps prevent emergencies on slippery roads?", options: { a: "Increase following distance", b: "Reduce speed", c: "Avoid sudden steering or braking", d: "All of the above" }, correct: "d" },
    { q: "If you see hazards early and plan a response, you will have more time to act.", options: { a: "True", b: "False", c: "Only in daylight" }, correct: "a" },
    { q: "At a crossing with gates and flashing lights, you should:", options: { a: "Stop when lights begin to flash", b: "Try to beat the gate if you think you can clear it", c: "Drive around the gate", d: "Honk and proceed" }, correct: "a" },
    { q: "If you must leave the vehicle after an emergency, you should:", options: { a: "Stand close to the vehicle on the roadway", b: "Move to a safe location away from traffic and tracks", c: "Wait between lanes", d: "Stay inside until help arrives" }, correct: "b" }
  ]},
  4: { title: "Vehicle Systems & Malfunctions", questions: [
    { q: "Which senses help you detect an oil leak early?", options: { a: "Sight (pools) and smell (burning oil)", b: "Only hearing", c: "Only touch" }, correct: "a" },
    { q: "Which signs indicate an auxiliary system malfunction (e.g., alternator, fan)?", options: { a: "Unusual noises and vibration", b: "Warning lights and loss of power", c: "Both a and b", d: "No signs until failure" }, correct: "c" },
    { q: "Which two senses help identify brake fade?", options: { a: "Sight and smell", b: "Smell and feeling (spongy pedal)", c: "Hearing and warning light" }, correct: "b" },
    { q: "What are common signs of a failing drive shaft?", options: { a: "Clunking sounds and vibration", b: "Excessive smoke", c: "Low coolant light" }, correct: "a" },
    { q: "If the tractor leans to one side, which system is likely at fault?", options: { a: "Leaf spring suspension", b: "Transmission", c: "Fuel system" }, correct: "a" },
    { q: "If you do not hear a click when coupling, what might be wrong?", options: { a: "Locking jaws did not close", b: "Tires are flat", c: "Brake lights are out" }, correct: "a" },
    { q: "What level of inspection is a walk-around driver/vehicle inspection?", options: { a: "Level 1", b: "Level 2", c: "Level 3" }, correct: "b" },
    { q: "Does a standard Pre-Trip Inspection help you pass a roadside inspection?", options: { a: "Yes, it finds items inspectors would catch", b: "No, it is unrelated", c: "Only sometimes" }, correct: "a" },
    { q: "If placed out-of-service, can you legally move the vehicle?", options: { a: "No", b: "Yes", c: "Yes, but only if you worked less than 11 hours" }, correct: "a" },
    { q: "Why perform preventive maintenance on equipment?", options: { a: "Extend service life and prevent breakdowns", b: "Only to satisfy paperwork", c: "To increase fuel use" }, correct: "a" },
    { q: "Which documents should be kept for FMCSA investigations?", options: { a: "Roadside inspection reports and DVIRs", b: "Only fuel receipts", c: "Personal notes" }, correct: "a" },
    { q: "Who is responsible for basic vehicle maintenance knowledge?", options: { a: "Drivers should know how to maintain CMVs", b: "Only mechanics need to know", c: "No one needs to know" }, correct: "a" },
    { q: "If a component has reached service life but not failed, you should:", options: { a: "Replace it as preventive maintenance", b: "Wait until it fails", c: "Ignore it" }, correct: "a" },
    { q: "If a vehicle is placed out-of-service for a defect, the correct action is to:", options: { a: "Move it immediately", b: "Fix the defect or get authorization before moving", c: "Drive slowly home" }, correct: "b" },
    { q: "After disconnecting air and electrical lines, what should you do with them?", options: { a: "Leave them on the ground", b: "Support them so they won't be damaged", c: "Tie them to the bumper" }, correct: "b" },
    { q: "When unlocking the fifth wheel during uncoupling, you must keep clear of tractor wheels because:", options: { a: "Legs and feet can be crushed if wheels move", b: "It is more comfortable", c: "It helps balance the trailer" }, correct: "a" },
    { q: "Before pulling the tractor clear of the trailer, you must ensure the landing gear is stable. Why?", options: { a: "To prevent the trailer from falling if gear collapses", b: "To save time", c: "To avoid paperwork" }, correct: "a" },
    { q: "Which of the following should be inspected when uncoupling a trailer?", options: { a: "Ground support and landing gear condition", b: "Only the tires", c: "Only the lights" }, correct: "a" }
  ]},
  5: { title: "Non-Driving Activities", questions: [
    { q: "If you fail to keep your medical certificate current, what can happen to your CDL?", options: { a: "It may be suspended", b: "Nothing happens", c: "You get a warning only" }, correct: "a" },
    { q: "Should you hide prescription medications from a DOT examiner?", options: { a: "Yes", b: "No", c: "Only if they are minor" }, correct: "b" },
    { q: "As a professional driver, who is responsible for cargo safety?", options: { a: "The driver", b: "Only the loader", c: "The shipper" }, correct: "a" },
    { q: "Why is it important to keep cargo low and centered?", options: { a: "To lower center of gravity and improve stability", b: "To make loading faster", c: "To increase fuel consumption" }, correct: "a" },
    { q: "How often must you have a tie-down for cargo?", options: { a: "At least one every 5 feet", b: "At least one every 10 feet", c: "Only at the ends" }, correct: "b" },
    { q: "What is the purpose of a header board on a flatbed trailer?", options: { a: "Protect the cab from shifting cargo", b: "Block wind when reversing", c: "Hold paperwork" }, correct: "a" },
    { q: "Before pulling out of a dock, you should:", options: { a: "Visually check the dock area for people and obstructions", b: "Rely on the dock worker to be clear", c: "Back out quickly" }, correct: "a" },
    { q: "If you have a major engine oil leak, the correct action is:", options: { a: "Keep driving and add oil", b: "Stop and repair or report before continuing", c: "Ignore it" }, correct: "b" },
    { q: "Where should you look for emergency response information for hazardous materials?", options: { a: "Emergency Response Guidebook (ERG)", b: "Internet forums", c: "Ask a coworker" }, correct: "a" },
    { q: "Interstate commerce means:", options: { a: "Traveling between states", b: "Staying within one state", c: "Only international travel" }, correct: "a" },
    { q: "Intrastate commerce means:", options: { a: "Operating within a single state", b: "Crossing state lines", c: "International transport" }, correct: "a" },
    { q: "Can you use a commercial vehicle for personal use and ignore federal HOS rules?", options: { a: "Yes", b: "No", c: "Only on weekends" }, correct: "b" },
    { q: "How many hours can you work in a 7-day period under common HOS rules (example)?", options: { a: "60 hours", b: "70 hours", c: "80 hours" }, correct: "a" },
    { q: "Should you secure cargo to prevent shifting during transport?", options: { a: "Yes", b: "No", c: "Only for heavy loads" }, correct: "a" },
    { q: "Which documents are important for EPA and cargo compliance?", options: { a: "Shipping papers and manifests", b: "Only fuel receipts", c: "Personal notes" }, correct: "a" },
    { q: "If you are fatigued, the best action is to:", options: { a: "Take a break or sleep before continuing", b: "Drink coffee and keep driving", c: "Open windows and drive on" }, correct: "a" },
    { q: "Which of the following helps manage fatigue on long trips?", options: { a: "Regular rest breaks and sleep", b: "Energy drinks only", c: "Skipping meals" }, correct: "a" },
    { q: "After a crash with injuries, you should first:", options: { a: "Ensure safety and call emergency services", b: "Move the vehicles immediately", c: "Leave the scene" }, correct: "a" },
    { q: "When communicating externally after an incident, you should:", options: { a: "Follow company procedures and report facts", b: "Speculate about causes", c: "Post on social media" }, correct: "a" },
    { q: "Whistleblowing protections mean you should:", options: { a: "Report safety violations without fear of retaliation", b: "Never report anything", c: "Only report to coworkers" }, correct: "a" },
    { q: "Trip planning should include:", options: { a: "Route, rest stops, fuel, and legal restrictions", b: "Only the fastest route", c: "No planning needed" }, correct: "a" },
    { q: "If you suspect a driver is under the influence, you should:", options: { a: "Report to your supervisor or authorities", b: "Ignore it", c: "Confront them aggressively" }, correct: "a" },
    { q: "Medical requirements for drivers include:", options: { a: "Keeping medical certificate current and reporting disqualifying conditions", b: "Only reporting if asked", c: "No medical checks" }, correct: "a" },
    { q: "Which is a correct practice for Post-Trip vehicle checks?", options: { a: "Record defects and report them immediately", b: "Fix them later at home", c: "Ignore minor defects" }, correct: "a" },
    { q: "How should you handle cargo that shifts during a trip?", options: { a: "Stop at a safe place and resecure the load", b: "Drive faster to the destination", c: "Ignore until arrival" }, correct: "a" },
    { q: "Which is required for transporting hazardous materials?", options: { a: "Proper shipping papers and placards", b: "Only verbal instructions", c: "No documentation" }, correct: "a" },
    { q: "If you discover a maintenance issue during a trip, you should:", options: { a: "Report it and take corrective action before continuing", b: "Continue and report later", c: "Hide it" }, correct: "a" },
    { q: "Which is a sign you should not drive: excessive drowsiness, blurred vision, or chest pain?", options: { a: "No — keep driving", b: "Yes — do not drive and seek help", c: "Only if severe" }, correct: "b" },
    { q: "Are you required to follow company policies for cargo securement and EPA rules?", options: { a: "No", b: "Yes", c: "Only sometimes" }, correct: "b" },
    { q: "What should you do if you are unsure about Hours-Of-Service rules for a trip?", options: { a: "Ignore them", b: "Guess based on experience", c: "Check company policy and federal rules before driving" }, correct: "c" },
    { q: "If a post-crash inspection is required, who usually performs it?", options: { a: "Qualified inspector or authorized personnel", b: "Any passerby", c: "Only the driver without documentation" }, correct: "a" },
    { q: "Which action helps reduce risk of DUI while on duty?", options: { a: "Avoid alcohol before and during duty periods", b: "Drink small amounts and drive", c: "Rely on coffee" }, correct: "a" },
    { q: "If a driver has a disqualifying medical condition, they must:", options: { a: "Report it and stop driving until cleared", b: "Keep driving and hide it", c: "Only tell a coworker" }, correct: "a" },
    { q: "Which is part of good trip planning for compliance?", options: { a: "Check weight limits, permits, and rest stops", b: "Only plan fuel stops", c: "Ignore permits" }, correct: "a" },
    { q: "When should you complete required paperwork for cargo and HOS?", options: { a: "Only at the end of the week", b: "Before and during the trip as required", c: "Never" }, correct: "b" }
  ]}
};

async function migrateQuizData() {
  try {
    console.log('🔄 Starting quiz data migration...');
    
    // Clear existing data to avoid duplicates
    await db.query('DELETE FROM quiz_multiple_choices');
    await db.query('DELETE FROM quiz_questions');
    await db.query('DELETE FROM quizes');
    await db.query('DELETE FROM course_sections WHERE course_id = 1');
    
    // Ensure course exists (should already be created by schema.sql)
    const courseResult = await db.query('SELECT id FROM courses WHERE id = 1');
    if (courseResult.rows.length === 0) {
      await db.query(`
        INSERT INTO courses (id, name, description, modified_by, active)
        VALUES (1, 'ELDT Class A CDL Theory', 'Entry-Level Driver Training - Class A Commercial Driver License Theory Course', 1, true)
      `);
      console.log('✅ Created main course');
    }

    let sectionNumber = 1;
    let totalQuestions = 0;
    
    for (const [sectionId, sectionData] of Object.entries(quizData)) {
      console.log(`📝 Processing section: ${sectionData.title}`);
      
      // Insert course section
      const sectionResult = await db.query(`
        INSERT INTO course_sections (course_id, section_name, section_number, modified_by, active)
        VALUES (1, $1, $2, 1, true)
        RETURNING id
      `, [sectionData.title, sectionNumber]);
      
      const dbSectionId = sectionResult.rows[0].id;
      
      // Insert quiz for this section
      const quizResult = await db.query(`
        INSERT INTO quizes (course_id, section_id, modified_by, active)
        VALUES (1, $1, 1, true)
        RETURNING id
      `, [dbSectionId]);
      
      const quizId = quizResult.rows[0].id;
      
      // Insert questions and choices
      for (let i = 0; i < sectionData.questions.length; i++) {
        const question = sectionData.questions[i];
        
        // Insert question
        const questionResult = await db.query(`
          INSERT INTO quiz_questions (quiz_id, question_name, modified_by, active)
          VALUES ($1, $2, 1, true)
          RETURNING id
        `, [quizId, question.q]);
        
        const questionId = questionResult.rows[0].id;
        
        // Insert multiple choice options
        for (const [choiceKey, choiceText] of Object.entries(question.options)) {
          const isCorrect = question.correct === choiceKey;
          
          await db.query(`
            INSERT INTO quiz_multiple_choices (question_id, choice_name, choice_description, is_correct, modified_by, active)
            VALUES ($1, $2, $3, $4, 1, true)
          `, [questionId, choiceKey, choiceText, isCorrect]);
        }
        
        totalQuestions++;
      }
      
      console.log(`✅ Migrated ${sectionData.questions.length} questions for "${sectionData.title}"`);
      sectionNumber++;
    }
    
    console.log(`🎉 Quiz data migration completed successfully! Total: ${totalQuestions} questions across ${Object.keys(quizData).length} sections`);
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

// Auto-assign course to all existing users
async function autoAssignCourse() {
  try {
    console.log('🔄 Auto-assigning course to existing users...');
    
    const result = await db.query(`
      INSERT INTO user_assigned_courses (user_id, company_id, course_id, modified_by, active)
      SELECT u.id, u.company_id, 1, 1, true
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_assigned_courses uac 
        WHERE uac.user_id = u.id AND uac.course_id = 1
      )
    `);
    
    console.log(`✅ Assigned course to ${result.rowCount} users`);
    
  } catch (error) {
    console.error('❌ Auto-assign error:', error);
    throw error;
  }
}

module.exports = {
  migrateQuizData,
  autoAssignCourse
};
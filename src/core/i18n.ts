/**
 * Localisation. Bangla is the default language, English is an option.
 * Every player-facing string in the game comes from this table; the mission /
 * catalogue data reference these keys instead of hard-coded copy.
 */

export type Locale = 'bn' | 'en';

interface Entry {
  bn: string;
  en: string;
}

export const STRINGS: Record<string, Entry> = {
  // ---------------------------------------------------------------- common
  'common.play': { bn: 'খেলা শুরু', en: 'Play' },
  'common.continue': { bn: 'চালিয়ে যান', en: 'Continue' },
  'common.garage': { bn: 'গ্যারেজ', en: 'Garage' },
  'common.store': { bn: 'দোকান', en: 'Store' },
  'common.settings': { bn: 'সেটিংস', en: 'Settings' },
  'common.credits': { bn: 'ক্রেডিট', en: 'Credits' },
  'common.back': { bn: 'ফিরে যান', en: 'Back' },
  'common.close': { bn: 'বন্ধ করুন', en: 'Close' },
  'common.cancel': { bn: 'বাতিল', en: 'Cancel' },
  'common.confirm': { bn: 'নিশ্চিত করুন', en: 'Confirm' },
  'common.ok': { bn: 'ঠিক আছে', en: 'OK' },
  'common.buy': { bn: 'কিনুন', en: 'Buy' },
  'common.equip': { bn: 'লাগান', en: 'Equip' },
  'common.equipped': { bn: 'লাগানো হয়েছে', en: 'Equipped' },
  'common.owned': { bn: 'আপনার রিকশা', en: 'Owned' },
  'common.repair': { bn: 'মেরামত', en: 'Repair' },
  'common.apply': { bn: 'প্রয়োগ করুন', en: 'Apply' },
  'common.max': { bn: 'সর্বোচ্চ', en: 'Max' },
  'common.loading': { bn: 'ঢাকা তৈরি হচ্ছে…', en: 'Building Dhaka…' },
  'common.saved': { bn: 'সেভ হয়েছে', en: 'Saved' },
  'common.needMore': { bn: 'আরও {n} দরকার', en: 'Need {n} more' },
  'common.insufficient': { bn: 'পর্যাপ্ত টাকা নেই', en: 'Not enough taka' },
  'common.free': { bn: 'বিনামূল্যে', en: 'Free' },
  'common.level': { bn: 'লেবেল {n}', en: 'Level {n}' },
  'common.version': { bn: 'সংস্করণ', en: 'Version' },
  'common.total': { bn: 'মোট', en: 'Total' },
  'common.none': { bn: 'নেই', en: 'None' },
  'common.locked': { bn: 'লক করা', en: 'Locked' },
  'common.best': { bn: 'সেরা', en: 'Best' },
  'common.time': { bn: 'সময়', en: 'Time' },
  'common.distance': { bn: 'দূরত্ব', en: 'Distance' },

  // ------------------------------------------------------------------ boot
  'boot.skip': { bn: 'শুরু / SKIP', en: 'SKIP' },
  'boot.tip': { bn: 'টিপ: বাঁ হাত দিয়ে স্টিয়ারিং, ডান হাতে প্যাডেল', en: 'Tip: steer with your left thumb, pedal with your right' },

  // ------------------------------------------------------------------ menu
  'menu.tagline': { bn: 'ঢাকার রাস্তায়, নিজের স্টাইলে', en: "On Dhaka's roads, in your own style" },
  'menu.modeTitle': { bn: 'কী করতে চান?', en: 'What are you up to?' },
  'menu.passengerDuty': { bn: 'যাত্রী ডিউটি', en: 'Passenger Duty' },
  'menu.passengerDutyDesc': { bn: 'যাত্রী তুলুন, ভাড়া কামান', en: 'Pick up passengers, earn fares' },
  'menu.freeRide': { bn: 'ফ্রি রাইড', en: 'Free Ride' },
  'menu.freeRideDesc': { bn: 'শহর ঘুরে দেখুন', en: 'Explore the neighbourhood' },
  'menu.daily': { bn: 'আজকের চ্যালেঞ্জ', en: 'Challenge of the Day' },
  'menu.dailyDesc': { bn: 'আজকের জন্য একটি কাজ', en: 'One special job, seeded by today' },
  'menu.district': { bn: 'পুরান ঢাকা', en: 'Old Dhaka' },
  'menu.districtNote': { bn: 'চকবাজার পাড়া', en: 'Chawkbazar quarter' },
  'menu.balance': { bn: 'ব্যালেন্স', en: 'Balance' },
  'menu.ridesDone': { bn: '{n} যাত্রা সম্পন্ন', en: '{n} rides completed' },
  'menu.tutorial': { bn: 'টিউটোরিয়াল', en: 'Tutorial' },
  'menu.levelLabel': { bn: '{title}', en: '{title}' },
  'menu.newGame': { bn: 'নতুন খেলা', en: 'New game' },
  'menu.resetWarn': { bn: 'সব অগ্রগতি মুছে যাবে। নিশ্চিত?', en: 'All progress will be erased. Are you sure?' },
  'menu.installed': { bn: 'অ্যাপ হিসেবে ইনস্টল', en: 'Install app' },
  'menu.offlineReady': { bn: 'অফলাইনে চলে', en: 'Works offline' },

  // -------------------------------------------------------------------- HUD
  'hud.pickup': { bn: 'যাত্রী তুলুন', en: 'Pick up passenger' },
  'hud.drop': { bn: 'যাত্রী নামান', en: 'Drop off passenger' },
  'hud.free': { bn: 'ফ্রি রাইড', en: 'Free ride' },
  'hud.none': { bn: 'কোনো কাজ নেই', en: 'No active job' },
  'hud.fare': { bn: 'ভাড়া', en: 'Fare' },
  'hud.mood': { bn: 'মন', en: 'Mood' },
  'hud.speed': { bn: 'গতি', en: 'Speed' },
  'hud.horn': { bn: 'বেল', en: 'BELL' },
  'hud.pedal': { bn: 'প্যাডেল', en: 'PEDAL' },
  'hud.brake': { bn: 'ব্রেক', en: 'BRAKE' },
  'hud.left': { bn: 'বাঁ', en: 'L' },
  'hud.right': { bn: 'ডা', en: 'R' },
  'hud.hintPickup': { bn: 'নামিয়ে যাত্রী তুলুন', en: 'Stop inside the zone to pick up' },
  'hud.hintDrop': { bn: 'জোনে থামুন', en: 'Stop inside the zone to drop off' },
  'hud.hintArrived': { bn: 'পৌঁছে গেছেন!', en: 'You have arrived!' },
  'hud.timeLeft': { bn: 'বাকি {n}', en: '{n} left' },
  'hud.late': { bn: 'দেরি হচ্ছে', en: 'Running late' },
  'hud.onTime': { bn: 'সময়ের মধ্যে', en: 'On time' },
  'hud.jobNext': { bn: 'নতুন যাত্রী খুঁজুন', en: 'Find the next fare' },
  'hud.jobAtStand': { bn: 'রিকশা স্ট্যান্ডে যান', en: 'Go to the rickshaw stand' },
  'hud.passengerAboard': { bn: 'যাত্রী উঠেছেন', en: 'Passenger on board' },
  'hud.stuck': { bn: 'আটকে গেছেন?', en: 'Stuck?' },
  'hud.recover': { bn: 'পুনরুদ্ধার', en: 'Recover' },

  // ------------------------------------------------------------------ pause
  'pause.title': { bn: 'বিরতি', en: 'Paused' },
  'pause.resume': { bn: 'চালিয়ে যান', en: 'Resume' },
  'pause.restart': { bn: 'মিশন আবার', en: 'Restart mission' },
  'pause.recover': { bn: 'রিকশা পুনরুদ্ধার', en: 'Recover rickshaw' },
  'pause.settings': { bn: 'সেটিংস', en: 'Settings' },
  'pause.quit': { bn: 'মেনুতে ফিরুন', en: 'Return to menu' },
  'pause.quitWarn': {
    bn: 'মিশন বাতিল হবে এবং এই যাত্রার আয় হারাবেন।',
    en: 'This cancels the job and you will lose this ride’s earnings.',
  },
  'pause.recoverFee': { bn: 'খরচ হবে {n}', en: 'Costs {n}' },
  'pause.autoSaved': { bn: 'অগ্রগতি সেভ করা হয়েছে', en: 'Progress saved' },

  // --------------------------------------------------------------- settings
  'settings.title': { bn: 'সেটিংস', en: 'Settings' },
  'settings.graphics': { bn: 'গ্রাফিক্স', en: 'Graphics' },
  'settings.quality': { bn: 'কোয়ালিটি', en: 'Quality' },
  'quality.low': { bn: 'কম / ব্যাটারি সেভার', en: 'Low / Battery saver' },
  'quality.balanced': { bn: 'মধ্যম', en: 'Balanced' },
  'quality.high': { bn: 'বেশি', en: 'High' },
  'settings.renderScale': { bn: 'রেন্ডার স্কেল', en: 'Render scale' },
  'settings.shadows': { bn: 'ছায়া', en: 'Shadows' },
  'settings.qualityNote': {
    bn: 'ট্রাফিক, ভিড়, বৃষ্টি ও ছায়া এখনই বদলে যাবে।',
    en: 'Traffic, crowds, rain and shadows change immediately.',
  },
  'settings.audio': { bn: 'শব্দ', en: 'Audio' },
  'settings.music': { bn: 'মিউজিক', en: 'Music' },
  'settings.ambience': { bn: 'শহরের শব্দ', en: 'Ambience' },
  'settings.traffic': { bn: 'ট্রাফিক', en: 'Traffic' },
  'settings.ui': { bn: 'ইন্টারফেস', en: 'UI' },
  'settings.dialogue': { bn: 'সংলাপ', en: 'Dialogue' },
  'settings.vehicle': { bn: 'রিকশা', en: 'Vehicle' },
  'settings.mute': { bn: 'সব নীরব', en: 'Mute all' },
  'settings.radioMode': { bn: 'শুনতে চাই', en: 'Listen to' },
  'settings.radio.both': { bn: 'মিউজিক ও শহর', en: 'Music + city' },
  'settings.radio.music': { bn: 'শুধু মিউজিক', en: 'Music only' },
  'settings.radio.street': { bn: 'শুধু শহর', en: 'City only' },
  'settings.controls': { bn: 'নিয়ন্ত্রণ', en: 'Controls' },
  'settings.steering': { bn: 'স্টিয়ারিং', en: 'Steering' },
  'settings.steering.buttons': { bn: 'বাঁ/ডান বাটন', en: 'Left / right buttons' },
  'settings.steering.wheel': { bn: 'আনালগ চাকা', en: 'Analog wheel' },
  'settings.handedness': { bn: 'কোন হাতে চালাবেন', en: 'Control hand' },
  'settings.rightHanded': { bn: 'ডান হাতি', en: 'Right-handed' },
  'settings.leftHanded': { bn: 'বাঁ হাতি', en: 'Left-handed' },
  'settings.sensitivity': { bn: 'সংবেদনশীলতা', en: 'Sensitivity' },
  'settings.deadzone': { bn: 'ডেড জোন', en: 'Dead zone' },
  'settings.cameraShake': { bn: 'ক্যামেরা কাঁপা', en: 'Camera shake' },
  'settings.haptics': { bn: 'ভাইব্রেশন', en: 'Haptics' },
  'settings.hapticsNote': { bn: 'ফোন সাপোর্ট করলে কম্পন হবে', en: 'Vibrates where the phone supports it' },
  'settings.language': { bn: 'ভাষা', en: 'Language' },
  'settings.accessibility': { bn: 'সুবিধা', en: 'Accessibility' },
  'settings.textSize': { bn: 'লেখার আকার', en: 'Text size' },
  'settings.hudScale': { bn: 'HUD আকার', en: 'HUD scale' },
  'settings.reduceEffects': { bn: 'কম ঝলকানি ও ইফেক্ট', en: 'Reduce effects' },
  'settings.subtitles': { bn: 'সংলাপের লেখা', en: 'Dialogue text' },
  'settings.fps': { bn: 'ফ্রেম রেট টার্গেট', en: 'Frame rate target' },
  'settings.fps30': { bn: '৩০ FPS', en: '30 FPS' },
  'settings.fps60': { bn: '৬০ FPS', en: '60 FPS' },
  'settings.reset': { bn: 'ডিফল্টে ফেরান', en: 'Reset to defaults' },
  'settings.resetDone': { bn: 'ডিফল্ট সেটিংস ফিরে এসেছে', en: 'Defaults restored' },
  'settings.tabletNote': {
    bn: 'এই ব্রাউজার/ডিভাইসে সব অপশন কাজ করে না, বাকিগুলো কাজ করছে।',
    en: 'Some options may be unavailable on this device; the rest still apply.',
  },

  // ----------------------------------------------------------------- garage
  'garage.title': { bn: 'গ্যারেজ', en: 'Garage' },
  'garage.subtitle': { bn: 'আপনার রিকশা, আপনার স্টাইল', en: 'Your rickshaw, your style' },
  'garage.paint': { bn: 'রং', en: 'Paint' },
  'garage.upgrades': { bn: 'আপগ্রেড', en: 'Upgrades' },
  'garage.accessories': { bn: 'সাজসজ্জা', en: 'Accessories' },
  'garage.vehicles': { bn: 'রিকশা', en: 'Rickshaws' },
  'garage.condition': { bn: 'অবস্থা', en: 'Condition' },
  'garage.repair': { bn: 'মেরামত করুন', en: 'Repair' },
  'garage.repairDone': { bn: 'রিকশা মেরামত হয়েছে', en: 'Rickshaw repaired' },
  'garage.conditionGood': { bn: 'রিকশা একদম ঠিক আছে', en: 'Rickshaw is in good shape' },
  'garage.repairCost': { bn: '{n} দিয়ে মেরামত', en: 'Repair for {n}' },
  'garage.drag': { bn: 'ঘোরাতে টানুন', en: 'Drag to rotate' },
  'garage.stats': { bn: 'পারফরম্যান্স', en: 'Performance' },
  'garage.own': { bn: 'আপনার', en: 'Owned' },
  'garage.selected': { bn: 'নির্বাচিত', en: 'Selected' },
  'garage.select': { bn: 'এই রিকশা নিন', en: 'Ride this one' },
  'garage.preview': { bn: 'প্রিভিউ', en: 'Preview' },
  'garage.chargeConfirm': { bn: '{name} কিনতে {price} খরচ হবে।', en: 'Buy {name} for {price}?' },
  'garage.buyConfirm': { bn: 'নিশ্চিত করুন', en: 'Confirm purchase' },
  'garage.tooPoor': { bn: 'আরও {n} লাগবে', en: '{n} more needed' },
  'garage.damaged': { bn: 'রিকশার অবস্থা কম, গতি কমছে', en: 'Low condition — your rides feel heavier' },
  'garage.stat.speed': { bn: 'গতি', en: 'Speed' },
  'garage.stat.handling': { bn: 'নিয়ন্ত্রণ', en: 'Handling' },
  'garage.stat.comfort': { bn: 'আরাম', en: 'Comfort' },
  'garage.stat.braking': { bn: 'ব্রেক', en: 'Braking' },

  // ------------------------------------------------------------------ store
  'store.title': { bn: 'দোকান', en: 'Store' },
  'store.subtitle': { bn: 'টাকার মূল্য দিন', en: 'Make every taka count' },
  'store.vehicles': { bn: 'রিকশা', en: 'Rickshaws' },
  'store.upgrades': { bn: 'আপগ্রেড', en: 'Upgrades' },
  'store.paint': { bn: 'রং ও শিল্প', en: 'Paint & art' },
  'store.accessories': { bn: 'সাজসজ্জা', en: 'Accessories' },
  'store.buyDone': { bn: 'কেনা হয়েছে!', en: 'Purchased!' },
  'store.equipDone': { bn: 'লাগানো হয়েছে', en: 'Equipped' },
  'store.notEnough': { bn: '{n} আরও দরকার', en: '{n} more needed' },
  'store.confirmTitle': { bn: 'কেনা নিশ্চিত করুন', en: 'Confirm purchase' },

  // ----------------------------------------------------------------- result
  'result.title': { bn: 'যাত্রা সম্পন্ন', en: 'Ride complete' },
  'result.failed': { bn: 'যাত্রা বাতিল', en: 'Ride cancelled' },
  'result.base': { bn: 'মূল ভাড়া', en: 'Base fare' },
  'result.distance': { bn: 'দূরত্বের ভাড়া', en: 'Distance' },
  'result.time': { bn: 'সময়ের বোনাস', en: 'On-time bonus' },
  'result.smooth': { bn: 'আরামদায়ক যাত্রা', en: 'Smooth ride' },
  'result.tip': { bn: 'বকশিশ', en: 'Tip' },
  'result.damage': { bn: 'ক্ষতির খরচ', en: 'Damage' },
  'result.total': { bn: 'মোট আয়', en: 'Total earned' },
  'result.next': { bn: 'পরের যাত্রী', en: 'Next job' },
  'result.freeRide': { bn: 'ফ্রি রাইড', en: 'Free ride' },
  'result.garage': { bn: 'গ্যারেজ', en: 'Garage' },
  'result.rating': { bn: 'যাত্রীর রেটিং', en: 'Rider rating' },
  'result.unlock': { bn: 'নতুন আনলক', en: 'New unlock' },
  'result.moodMood': { bn: 'যাত্রীর মন', en: 'Passenger mood' },
  'result.boss': { bn: 'বস ড্রাইভার', en: 'BOSS DRIVER' },
  'result.smoothStamp': { bn: 'সিল্ক স্মুথ', en: 'SILK SMOOTH' },
  'result.fastStamp': { bn: 'বিদ্যুৎ গতি', en: 'LIGHTNING' },
  'result.late': { bn: 'দেরি হয়েছে', en: 'Late' },
  'result.dailyDone': { bn: 'আজকের চ্যালেঞ্জ সম্পন্ন', en: 'Daily challenge complete' },

  // --------------------------------------------------------------- dialogue
  'who.student': { bn: 'ছাত্র', en: 'Student' },
  'who.office': { bn: 'অফিসযাত্রী', en: 'Office worker' },
  'who.shopper': { bn: 'কেনাকাটা যাত্রী', en: 'Shopper' },
  'who.elder': { bn: 'মুরুব্বি', en: 'Elderly rider' },
  'who.tourist': { bn: 'পর্যটক', en: 'Tourist' },
  'who.singer': { bn: 'গায়ক', en: 'Musician' },
  'd.student.greet': { bn: 'ভাই, বিশ্ববিদ্যালয় যাব।', en: 'Bhai, to the university please.' },
  'd.office.greet': { bn: 'অফিসে দেরি হয়ে যাচ্ছে, তাড়াতাড়ি করেন।', en: 'I am late for office — please hurry.' },
  'd.shopper.greet': { bn: 'বাজার থেকে ফিরছি, আস্তে চালাবেন।', en: 'Coming back from the market, drive gently.' },
  'd.elder.greet': { bn: 'স্ট্যান্ড পর্যন্ত যাব, আরাম করে চালান।', en: 'To the stand, drive comfortably.' },
  'd.tourist.greet': { bn: 'এই গলিগুলো খুব সুন্দর!', en: 'These lanes are lovely!' },
  'd.singer.greet': { bn: 'আজ রেওয়াজ আছে, তাড়া আছে ভাই।', en: 'I have a rehearsal — I am in a hurry.' },
  'd.fast': { bn: 'ভাই, একটু তাড়াতাড়ি।', en: 'A little faster, bhai.' },
  'd.slow': { bn: 'আস্তে চালান, ভাই।', en: 'Slow down a little, bhai.' },
  'd.lane': { bn: 'এই গলিটা দিয়ে যান।', en: 'Take this lane.' },
  'd.rain': { bn: 'বৃষ্টি নামার আগেই পৌঁছাই।', en: 'Let us arrive before the rain.' },
  'd.fare': { bn: 'ভাড়া কত?', en: 'How much is the fare?' },
  'd.drop': { bn: 'এখানেই নামিয়ে দিন।', en: 'Drop me right here.' },
  'd.happy': { bn: 'বাহ, দারুণ চালান!', en: 'Wow, you drive well!' },
  'd.neutral': { bn: 'ঠিক আছে, ধীরে চালান।', en: 'Okay, easy does it.' },
  'd.annoyed': { bn: 'ভাই, একটু সাবধানে!', en: 'Careful, bhai!' },
  'd.thanks': { bn: 'ধন্যবাদ ভাই!', en: 'Thanks, bhai!' },
  'd.midroute': { bn: 'একটু দ্রুত করলে ভালো হয়।', en: 'A bit quicker would be nice.' },
  'd.pickup': { bn: 'এই যে, এখানে!', en: 'Here, over here!' },
  'd.enter': { bn: 'চলেন, বের হন।', en: 'Alright, let us go.' },

  // ------------------------------------------------------------------ toast
  'toast.newJob': { bn: 'নতুন যাত্রী অপেক্ষা করছে', en: 'A passenger is waiting' },
  'toast.pickup': { bn: 'যাত্রী উঠেছেন', en: 'Passenger on board' },
  'toast.drop': { bn: 'যাত্রী নামলেন', en: 'Passenger dropped off' },
  'toast.purchase': { bn: 'কেনা হয়েছে', en: 'Purchased' },
  'toast.equipped': { bn: 'লাগানো হয়েছে', en: 'Equipped' },
  'toast.repaired': { bn: 'মেরামত সম্পন্ন', en: 'Repaired' },
  'toast.unlock': { bn: 'নতুন আনলক: {name}', en: 'Unlocked: {name}' },
  'toast.recovered': { bn: 'রিকশা রাস্তায় ফেরা হয়েছে', en: 'Rickshaw recovered' },
  'toast.notEnough': { bn: 'টাকা যথেষ্ট নয়', en: 'Not enough taka' },
  'toast.saved': { bn: 'সেভ হয়েছে', en: 'Game saved' },
  'toast.rainSoon': { bn: 'বৃষ্টি আসছে…', en: 'Rain is coming…' },
  'toast.dailyDone': { bn: 'আজকের চ্যালেঞ্জ শেষ!', en: 'Daily challenge complete!' },
  'toast.freeRide': { bn: 'ফ্রি রাইড — শহর ঘুরে দেখুন', en: 'Free ride — explore the city' },
  'toast.conditionLow': { bn: 'রিকশার অবস্থা কম', en: 'Rickshaw condition is low' },
  'toast.tape': { bn: 'নতুন টেপ: {name}', en: 'New tape: {name}' },

  // --------------------------------------------------------------- missions
  'mission.standard': { bn: 'যাত্রী পৌঁছে দিন', en: 'Passenger delivery' },
  'mission.daily': { bn: 'আজকের যাত্রা', en: "Today's ride" },
  'mission.to': { bn: '{place}-এ যান', en: 'To {place}' },
  'mission.from': { bn: '{place} থেকে তুলুন', en: 'Pick up at {place}' },
  'mission.pickupHere': { bn: 'যাত্রী এখানেই আছেন', en: 'Pick up here' },
  'mission.negotiate': { bn: 'ভাড়া: {fare}', en: 'Fare: {fare}' },
  'mission.optional.fast': { bn: 'দ্রুত পৌঁছে দিন', en: 'Arrive quickly' },
  'mission.optional.smooth': { bn: 'আরামদায়ক যাত্রা', en: 'Keep it smooth' },
  'mission.optional.alley': { bn: 'গলি দিয়ে যান', en: 'Try the back lane' },
  'mission.optional.rain': { bn: 'বৃষ্টির আগে পৌঁছান', en: 'Beat the rain' },
  'mission.optionalLane': { bn: 'চাইলে গলিপথ নিতে পারেন', en: 'Optional: take the lane' },

  // ------------------------------------------------------------ achievements
  'ach.firstRide': { bn: 'প্রথম যাত্রী', en: 'First passenger' },
  'ach.tenRides': { bn: '১০ যাত্রা', en: '10 rides' },
  'ach.cleanRun': { bn: 'নিখুঁত যাত্রা', en: 'Clean run' },
  'ach.rainRide': { bn: 'বৃষ্টির যাত্রা', en: 'Rainy delivery' },
  'ach.alleyTurn': { bn: 'গলির কারিগর', en: 'Alley master' },
  'ach.explorer': { bn: 'পাড়া চেনা', en: 'Knows the neighbourhood' },
  'ach.firstUpgrade': { bn: 'প্রথম আপগ্রেড', en: 'First upgrade' },

  // ------------------------------------------------------------------ titles
  'title.rookie': { bn: 'নতুন রিকশাওয়ালা', en: 'Rookie puller' },
  'title.regular': { bn: 'পাড়ার চেনা মুখ', en: 'Neighbourhood regular' },
  'title.veteran': { bn: 'পুরান ঢাকার ড্রাইভার', en: 'Old Dhaka driver' },
  'title.legend': { bn: 'বাংলার টেসলা', en: 'Banglar Tesla' },

  // ----------------------------------------------------------------- places
  'place.stand': { bn: 'রিকশা স্ট্যান্ড', en: 'Rickshaw stand' },
  'place.tea': { bn: 'চায়ের দোকান', en: 'Tea stall' },
  'place.bazaar': { bn: 'কাঁচা বাজার', en: 'Kacha Bazar' },
  'place.school': { bn: 'স্কুল মোড়', en: 'School corner' },
  'place.garage': { bn: 'রিকশা মেরামত', en: 'Rickshaw repair' },
  'place.pharmacy': { bn: 'ফার্মেসি', en: 'Pharmacy' },
  'place.launch': { bn: 'লঞ্চ ঘাট', en: 'Launch ghat' },
  'place.mosque': { bn: 'মসজিদ গলি', en: 'Mosque lane' },
  'place.market': { bn: 'মুদি বাজার', en: 'Grocery market' },
  'place.bridge': { bn: 'ছোট সেতু', en: 'Small bridge' },
  'place.library': { bn: 'বই ঘর', en: 'Book house' },

  // ---------------------------------------------------------------- credits
  'credits.title': { bn: 'ক্রেডিট', en: 'Credits' },
  'credits.made': { bn: 'একটি অরিজিনাল বাংলাদেশি গেম', en: 'An original Bangladeshi game' },
  'credits.design': { bn: 'গেম ডিজাইন ও কোড', en: 'Game design & code' },
  'credits.engine': { bn: 'ইঞ্জিন', en: 'Engine' },
  'credits.fonts': { bn: 'ফন্ট', en: 'Fonts' },
  'credits.audio': { bn: 'সঙ্গীত ও শব্দ', en: 'Music & sound' },
  'credits.audioNote': {
    bn: 'সব মিউজিক ও শব্দ কোডে রিয়েল-টাইমে তৈরি — কোনো কপিরাইট গান নেই।',
    en: 'All music and SFX are synthesised in code at runtime — no copyrighted recordings.',
  },
  'credits.assets': { bn: 'মডেল ও টেক্সচার', en: 'Models & textures' },
  'credits.assetsNote': {
    bn: 'সব ৩D মডেল ও টেক্সচার এই প্রজেক্টের জন্য প্রসিডিউরালি তৈরি।',
    en: 'Every 3D model and texture is generated procedurally for this project.',
  },
  'credits.mapNote': {
    bn: 'মানচিত্রটি একটি কল্পিত গেম-লেআউট, বাস্তব নেভিগেশন মানচিত্র নয়।',
    en: 'The map is a fictional game layout, not a real navigation map.',
  },
  'credits.thanks': { bn: 'ঢাকার সব রিকশাওয়ালাকে ভালোবাসা', en: 'With love to every rickshaw puller in Dhaka' },

  // --------------------------------------------------------------- tutorial
  'tut.1.title': { bn: 'স্বাগতম, ড্রাইভার!', en: 'Welcome, driver!' },
  'tut.1.body': {
    bn: 'ডান দিকের প্যাডেল চেপে ধরে রিকশা চালান। বাঁ দিকের বাটন দিয়ে বাঁক নিন।',
    en: 'Hold the right pedal to ride. Use the left buttons to steer.',
  },
  'tut.2.title': { bn: 'যাত্রী তুলুন', en: 'Pick up a passenger' },
  'tut.2.body': {
    bn: 'সবুজ চিহ্নে গিয়ে একদম থামুন। যাত্রী নিজেই উঠে আসবেন।',
    en: 'Stop right inside the green marker. The passenger walks over to you.',
  },
  'tut.3.title': { bn: 'নামিয়ে দিন', en: 'Drop off' },
  'tut.3.body': {
    bn: 'গন্তব্যের চিহ্নে থামুন। আস্তে চালালে যাত্রী খুশি থাকেন, বেশি বকশিশ।',
    en: 'Stop inside the destination marker. Smoother rides mean happier passengers and better tips.',
  },
  'tut.4.title': { bn: 'ভাড়া খরচ করুন', en: 'Spend your fares' },
  'tut.4.body': {
    bn: 'গ্যারেজে রিকশা মেরামত করুন, রং বদলান, নতুন আপগ্রেড নিন।',
    en: 'In the garage you can repair, repaint and upgrade your rickshaw.',
  },
  'tut.skip': { bn: 'টিউটোরিয়াল বাদ', en: 'Skip tutorial' },
  'tut.next': { bn: 'পরের ধাপ', en: 'Next' },
  'tut.done': { bn: 'বুঝেছি', en: 'Got it' },

  // ------------------------------------------------------- store catalogue
  'veh.classic': { bn: 'ক্লাসিক ঢাকা', en: 'Classic Dhaka' },
  'veh.classic.desc': { bn: 'পুরনো কিন্তু প্রাণবন্ত প্রথম রিকশা', en: 'Your worn, charming starter rickshaw' },
  'veh.neel': { bn: 'নীল বিজলি', en: 'Neel Bijli' },
  'veh.neel.desc': { bn: 'গাঢ় নীল ক্যানভাস, রুপালি আঁচ', en: 'Deep blue canopy with silver-blue detail' },
  'veh.shapla': { bn: 'লাল শাপলা', en: 'Lal Shapla' },
  'veh.shapla.desc': { bn: 'লাল-সবুজ ফুলের হাতে আঁকা নকশা', en: 'Red and green hand-painted floral panels' },
  'veh.cinema': { bn: 'সিনেমা কিং', en: 'Cinema King' },
  'veh.cinema.desc': { bn: 'নাটকীয় পোস্টার-স্টাইল প্যানেল', en: 'Dramatic invented movie-poster panels' },
  'up.tyres': { bn: 'টায়ার ও গ্রিপ', en: 'Tyres & grip' },
  'up.tyres.desc': { bn: 'ভেজা রাস্তায় নিয়ন্ত্রণ ভালো হয়', en: 'Better control in rain and on rough patch' },
  'up.brakes': { bn: 'ব্রেক', en: 'Brakes' },
  'up.brakes.desc': { bn: 'কম দূরত্বে নিরাপদে থামুন', en: 'Stop shorter and more stably' },
  'up.bearings': { bn: 'বিয়ারিং', en: 'Bearings' },
  'up.bearings.desc': { bn: 'সহজে গতি ওঠে, কম শব্দ', en: 'Smoother acceleration, less drag' },
  'up.steering': { bn: 'স্টিয়ারিং লিংকেজ', en: 'Steering linkage' },
  'up.steering.desc': { bn: 'বাঁক নিতে আরও দৃঢ়', en: 'Tighter, more confident turns' },
  'up.seat': { bn: 'সিট ও সাসপেনশন', en: 'Seat & suspension' },
  'up.seat.desc': { bn: 'গর্তেও যাত্রী আরামে', en: 'Comfort over potholes' },
  'up.canopy': { bn: 'ক্যানভাস', en: 'Canopy' },
  'up.canopy.desc': { bn: 'রোদ-বৃষ্টিতে সুরক্ষা', en: 'Protection from sun and rain' },
  'up.lights': { bn: 'লাইট ও রিফ্লেক্টর', en: 'Lights & reflectors' },
  'up.lights.desc': { bn: 'রাতে ভালো দেখা যায়', en: 'See and be seen at night' },
  'cos.paint.red': { bn: 'লাল প্যানেল', en: 'Rickshaw red' },
  'cos.paint.blue': { bn: 'নীল প্যানেল', en: 'Electric blue' },
  'cos.paint.green': { bn: 'সবুজ প্যানেল', en: 'Bottle green' },
  'cos.paint.gold': { bn: 'সোনালি প্যানেল', en: 'Gold leaf' },
  'cos.paint.teal': { bn: 'সবুজাভ নীল', en: 'Ghat teal' },
  'cos.art.floral': { bn: 'ফুলের নকশা', en: 'Floral panel art' },
  'cos.art.bird': { bn: 'পাখির নকশা', en: 'Bird panel art' },
  'cos.art.river': { bn: 'নদীর নকশা', en: 'River panel art' },
  'cos.art.cinema': { bn: 'সিনেমা নকশা', en: 'Cinema panel art' },
  'cos.tassel.red': { bn: 'লাল ঝালর', en: 'Red tassels' },
  'cos.tassel.gold': { bn: 'সোনালি ঝালর', en: 'Gold tassels' },
  'cos.tassel.green': { bn: 'সবুজ ঝালর', en: 'Green tassels' },
  'cos.bell.classic': { bn: 'ক্লাসিক ঘণ্টা', en: 'Classic tring-tring' },
  'cos.bell.brass': { bn: 'পিতলের ঘণ্টা', en: 'Brass bell' },
  'cos.bell.double': { bn: 'ডাবল ঘণ্টা', en: 'Double bell' },
  'cos.flowers.marigold': { bn: 'গাঁদা ফুল', en: 'Marigold flowers' },
  'cos.flowers.rose': { bn: 'গোলাপ', en: 'Paper roses' },
  'cos.mirror.round': { bn: 'গোল আয়না', en: 'Round mirror' },
  'cos.mirror.star': { bn: 'তারা আয়না', en: 'Star mirror' },

  // ---------------------------------------------------------------- tapes
  'tape.cassette': { bn: 'ক্যাসেট ঢাকা', en: 'Cassette Dhaka' },
  'tape.radio': { bn: 'রিকশা রেডিও', en: 'Rickshaw Radio' },
  'tape.brishti': { bn: 'বৃষ্টি ও সন্ধ্যা', en: 'Brishti at Dusk' },
  'tape.locked': { bn: 'আনলক করতে যাত্রা সম্পন্ন করুন', en: 'Complete rides to unlock' },

  // ------------------------------------------------------------- daily mode
  'daily.ride1': { bn: 'আজকের চ্যালেঞ্জ: দ্রুত পৌঁছান', en: 'Daily: arrive fast' },
  'daily.ride2': { bn: 'আজকের চ্যালেঞ্জ: আরামদায়ক যাত্রা', en: 'Daily: keep it smooth' },
  'daily.ride3': { bn: 'আজকের চ্যালেঞ্জ: বৃষ্টির আগে', en: 'Daily: beat the rain' },
  'daily.done': { bn: 'আজকের চ্যালেঞ্জ সম্পন্ন হয়েছে', en: 'Today’s challenge is complete' },
};

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let text = entry ? entry[locale] : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

let currentLocale: Locale = 'bn';
const localeListeners = new Set<(l: Locale) => void>();

export function setLocale(locale: Locale): void {
  if (locale !== 'bn' && locale !== 'en') return;
  if (currentLocale === locale) return;
  currentLocale = locale;
  for (const fn of localeListeners) fn(locale);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function onLocaleChange(fn: (l: Locale) => void): () => void {
  localeListeners.add(fn);
  return () => localeListeners.delete(fn);
}

/** Translate using the active locale. */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params);
}

export function hasString(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(STRINGS, key);
}

export const STRING_KEYS = Object.keys(STRINGS);

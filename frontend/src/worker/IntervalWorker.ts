const generateMinuteMarks = (stepMin: number) => {
  const minuteMarks: number[] = [];
  for (let i = 0; i <= 60; i+= stepMin) {
    minuteMarks.push(i);
  };

  return minuteMarks;
};
// need to fix accuracy in firefox
let timeoutId: ReturnType<typeof setTimeout> | undefined;
let intervalId: ReturnType<typeof setInterval> | undefined;

const isWithinMarketHoursIST = (d = new Date()) => {
  // Convert local time to IST
  const local = d.getTime();
  const tzOffsetMin = d.getTimezoneOffset(); // minutes difference to UTC; IST is +330
  const ist = new Date(local + (tzOffsetMin + 330) * 60000);
  const day = ist.getDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return false; // Sun/Sat
  const hour = ist.getHours();
  const minute = ist.getMinutes();
  const afterOpen = hour > 9 || (hour === 9 && minute >= 15);
  const beforeClose = hour < 15 || (hour === 15 && minute <= 30);
  return afterOpen && beforeClose;
};

const schedule = (callbackFn: () => void, stepMin: 1 | 3 | 5 | 15) => {
  // Clear any existing timers
  if (timeoutId) clearTimeout(timeoutId);
  if (intervalId) clearInterval(intervalId);

  const now = new Date();
  const currentTime = now.getTime();
  const currentMinutes = now.getMinutes();
  const minuteMarks = generateMinuteMarks(stepMin);

  const nextMinuteMark = minuteMarks.find((mark) => mark > currentMinutes);

  const next = new Date();
  next.setMinutes(nextMinuteMark ?? 0);
  next.setSeconds(0);

  const timeToNext = next.getTime() - currentTime;

  timeoutId = setTimeout(() => {
    if (isWithinMarketHoursIST()) callbackFn();
    intervalId = setInterval(() => {
      if (isWithinMarketHoursIST()) callbackFn();
    }, stepMin * 60000);
  }, timeToNext < 0 ? 0 : timeToNext);
};

type Message = {
  action: string,
};

self.onmessage = (e) => {
  const data = e.data as any;
  const action = data.action as string;
  if (action === "start") {
    const stepMin = (data.intervalMin as 1 | 3 | 5 | 15) ?? 3;
    schedule(() => self.postMessage("get-oi"), stepMin);
  } else if (action === "update-interval") {
    const stepMin = (data.intervalMin as 1 | 3 | 5 | 15) ?? 3;
    schedule(() => self.postMessage("get-oi"), stepMin);
  } else if (action === "stop") {
    if (timeoutId) clearTimeout(timeoutId);
    if (intervalId) clearInterval(intervalId);
  }
};

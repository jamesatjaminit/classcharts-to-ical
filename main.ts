import {
  dayjs,
  Hono,
  ical,
  ICalCalendarMethod,
  outdent,
  StudentClient,
} from "./deps.ts";
import { checkAndAddRateLimit } from "./kv.ts";

function getFilename(url: string, dob: string) {
  const requestedUrl = new URL(url);
  let filename = requestedUrl.pathname.split("/").at(-1);
  filename = filename === dob ? "calendar.ics" : filename;
  return filename;
}
const dateOfBirthRegex = /^[0-9]{1,2}\-[0-9]{1,2}\-[0-9]{4}$/;

const app = new Hono();

app.get("/", async (c) => {
  const url = new URL(c.req.url);
  const currentUrl = `${url.protocol}//${url.hostname}${
    url.port.length > 0 && url.port !== "80" && url.port !== "443"
      ? `:${url.port}`
      : ""
  }`;
  const banner = await Deno.readTextFile("banner.txt");
  return c.text(outdent`
	${banner}


	--- Endpoints ---
	- Timetable2ICal: ${currentUrl}/v2/timetable/classchartsCode/dateOfBirth/calendar.ics
	- Homework2ICal: ${currentUrl}/v2/homework/classchartsCode/dateOfBirth/calendar.ics

	--- Notes ---
	Make sure to replace the classchartsCode and dateOfBirth with your own details.
	dateOfBirth should be in format: DD-MM-YYYY
	
	Timetable2Ical returns lessons a week prior, and 32 days after the current date (${
    dayjs().format(
      "DD/MM/YYYY",
    )
  }).
	Homework2ICal returns homework 32 days prior and a year in advance of the current date (${
    dayjs().format(
      "DD/MM/YYYY",
    )
  }).
	These limits are due to having to request timetable days individually, whereas homework can be requested in a single request.
	Feel free to modify the code and host your own instance to alter these limits.
	
	--- Rate Limits ---
	10 requests per endpoint, per hour. Limited by a hash of your ClassCharts code & date of birth.

	--- Privacy ---
	The only data which is collected is your classcharts code and date of birth (both hashed via Argon2) for the purpose of rate limiting. 
	If you are worried about privacy, it's super easy to host your own instance, see the source link below.

	--- Source ---
	The source code is avaliable to host yourself at: https://github.com/jamesatjaminit/classcharts-to-ical
	And can easily be deployed to Deno Deploy without any configuration.
	
	--- Contact ---
	https://jamesatjaminit.dev
	`);
});

app.options("*", (c) => {
  return c.text("", 200, {
    Allow: "OPTIONS, GET",
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "Content-Type, Content-Disposition",
    "Access-Control-Allow-Origin": "*",
  });
});

app.get("/v2/timetable/:code/:dob/*", async (c) => {
  const code = c.req.param("code");
  const dob = c.req.param("dob");

  if (dateOfBirthRegex.test(dob) === false) {
    return c.text("Invalid date of birth. Should be in format DD-MM-YYYY", 400);
  }
  if (
    (await checkAndAddRateLimit(
      "timetable",
      code + "/" + dob,
      10,
      60 * 60 * 1000,
    )) === false
  ) {
    return c.text("Rate limited. Check the home page for details.", {
      status: 429,
    });
  }
  const classchartsClient = new StudentClient(code, dob.replaceAll("-", "/"));
  try {
    await classchartsClient.login();
  } catch {
    return c.text("Failed to authenticate with ClassCharts", 400);
  }
  const calendar = ical({ name: "ClassCharts Timetable" });
  calendar.method(ICalCalendarMethod.REQUEST);

  const currentDay = dayjs().subtract(7, "day");

  for (let i = 1; i <= 40; i++) {
    try {
      const timetableForDay = await classchartsClient.getLessons({
        date: currentDay.add(i, "day").format("YYYY-MM-DD"),
      });
      for (const lesson of timetableForDay.data) {
        calendar.createEvent({
          start: dayjs(lesson.start_time).toDate(),
          end: dayjs(lesson.end_time).toDate(),
          summary: `${lesson.lesson_name} - ${lesson.room_name}`,
          description: outdent`
					Teacher Name: ${lesson.teacher_name}
					Subject: ${lesson.subject_name}
					Synced At: ${dayjs().toString()}
					`,
        });
      }
    } catch {
      // Shushhhhh
    }
  }
  const filename = getFilename(c.req.url, dob);
  return c.text(calendar.toString(), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

app.get("/v2/homework/:code/:dob/*", async (c) => {
  const code = c.req.param("code");
  const dob = c.req.param("dob");

  if (dateOfBirthRegex.test(dob) === false) {
    return c.text("Invalid date of birth. Should be in format DD-MM-YYYY", 400);
  }
  if (
    (await checkAndAddRateLimit(
      "homework",
      code + "/" + dob,
      10,
      60 * 60 * 1000,
    )) === false
  ) {
    return c.text("Rate limited. Check the home page for details.", {
      status: 429,
    });
  }
  const classchartsClient = new StudentClient(code, dob.replaceAll("-", "/"));
  try {
    await classchartsClient.login();
  } catch {
    return c.text("Failed to authenticate with ClassCharts", 400);
  }

  const homeworks = (
    await classchartsClient.getHomeworks({
      from: dayjs().subtract(32, "day").format("YYYY-MM-DD"),
      to: dayjs().add(366, "day").format("YYYY-MM-DD"),
      displayDate: "due_date",
    })
  ).data;

  const calendar = ical({ name: "ClassCharts Homeworks" });
  calendar.method(ICalCalendarMethod.REQUEST);
  for (const homework of homeworks) {
    let status = "TODO";
    if (homework.status.state === "completed") {
      status = "SUBMITTED";
    } else if (homework.status.ticked === "yes") {
      status = "TICKED";
    }
    calendar.createEvent({
      start: dayjs(homework.due_date).toDate(),
      summary: homework.title,
      description: outdent`
			Subject: ${homework.subject}
			Teacher: ${homework.teacher}
			Issue Date: ${dayjs(homework.issue_date).toString()}
			Status: ${status}
			Synced At: ${dayjs().toString()}
			More Info: https://www.classcharts.com/mobile/student#${classchartsClient.studentId},homework,${homework.id}
			Description: 
			${homework.description.replace(/<[^>]*>?/gm, "").trim()}
			`,
      allDay: true,
    });
  }

  const filename = getFilename(c.req.url, dob);
  return c.text(calendar.toString(), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

Deno.serve(app.fetch);

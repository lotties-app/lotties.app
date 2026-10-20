/** Local validation failures raised by event commands (mirror the API domain rules). */
export class EventCommandError extends Error {
  readonly eventId: string;

  constructor(eventId: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.eventId = eventId;
  }
}

export class EventNotFoundError extends EventCommandError {
  constructor(eventId: string) {
    super(eventId, `Event ${eventId} was not found.`);
  }
}

export class EventDeletedError extends EventCommandError {
  constructor(eventId: string) {
    super(eventId, `Event ${eventId} is deleted.`);
  }
}

export class EventAlreadyStoppedError extends EventCommandError {
  constructor(eventId: string) {
    super(eventId, `Event ${eventId} is not running.`);
  }
}

export class InvalidEventTimeRangeError extends EventCommandError {
  constructor(eventId: string) {
    super(eventId, `Event ${eventId} must not end before it starts.`);
  }
}

export interface CommerceEvent {
  type: string;
  at: number;
  [field: string]: unknown;
}

export type EventHandler = (event: CommerceEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly log: CommerceEvent[] = [];

  subscribe(type: string, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  publish(event: CommerceEvent): void {
    this.log.push(structuredClone(event));
    for (const handler of this.handlers.get(event.type) ?? []) handler(structuredClone(event));
  }

  history(): CommerceEvent[] {
    return structuredClone(this.log);
  }
}

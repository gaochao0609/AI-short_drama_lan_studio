declare module "pg" {
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(text: string, values?: readonly unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }
}

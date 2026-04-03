import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Returns a simple greeting payload for the root endpoint. */
  getData(): { message: string } {
    return { message: 'Hello API' };
  }
}

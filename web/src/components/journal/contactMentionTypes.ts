export type JournalContactReference = {
  readonly id: string;
  readonly name: string;
  readonly firstName?: string;
  readonly lastName?: string;
};

export type PostContactReference = {
  readonly id?: string;
  readonly name?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly middle_name?: string;
  readonly nickname?: string;
  readonly maiden_name?: string;
  readonly prefix?: string;
  readonly suffix?: string;
};

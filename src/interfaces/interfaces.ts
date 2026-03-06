import { RowDataPacket } from "mysql2";

export interface IRedirectIndex {
    links_count: number;
    root_url: string;
    links: IRedirectLinkPublic[];
}

export interface IRedirectLinkPublic extends RowDataPacket {
    title: string;
    shortname: string;
    redirect_url: string;
    short_url: string;
}

export interface IRedirectLink extends RowDataPacket {
    id: number;
    d365_id?: string;
    title: string;
    shortname: string;
    redirect_url: string;
    used_count: number;
    indexed: boolean;
    last_updated: Date;
}
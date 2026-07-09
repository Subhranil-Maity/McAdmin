mod files;
mod get_config;
mod get_server_properties;
mod health;
mod list_config;
mod players;
mod send_server_command;
mod server_status;
mod start_server;
mod stop_server;
mod update_server_properties;

use std::collections::BTreeMap;

pub(crate) use files::{get_file_content, list_directory, upload_file, write_file};
pub(crate) use get_config::get_config;
pub(crate) use get_server_properties::get_server_properties;
pub(crate) use health::health;
pub(crate) use list_config::list_config;
pub(crate) use players::{
    ban_player, deop_player, dewhitelist_player, get_all_players, get_online_players,
    op_player, unban_player, whitelist_player,
};
pub(crate) use send_server_command::send_server_command;
pub(crate) use server_status::server_status;
pub(crate) use start_server::start_server;
pub(crate) use stop_server::stop_server;
pub(crate) use update_server_properties::update_server_properties;

pub(crate) const SERVER_PROPERTIES_FILE: &str = "server.properties";
pub(crate) type ServerProperties = BTreeMap<String, String>;

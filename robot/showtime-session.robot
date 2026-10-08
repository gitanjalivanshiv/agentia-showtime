*** Settings ***
Documentation     Bootstrap suite for Showtime live recording sessions.
...               Showtime drives the real steps one keyword at a time through
...               `agentia testing live execute`; this file only provides the library.
Library           QWeb
Suite Setup       Open Browser    about:blank    chrome
Suite Teardown    Close All Browsers

*** Test Cases ***
Showtime Session
    [Documentation]    Placeholder test that Showtime's live session attaches to.
    No Operation

cmake_minimum_required(VERSION 3.13)

# Define the library name here.
project(appmodules)

# This file includes all the necessary to let you build your application with the New Architecture.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# Explicitly link libc++_shared to all autolinked targets so they can resolve C++ runtime
# symbols (operator new, __cxa_throw, etc.) at link time.
find_library(CPP_SHARED c++_shared)
if(CPP_SHARED AND AUTOLINKED_LIBRARIES)
  foreach(autolinked_library ${AUTOLINKED_LIBRARIES})
    target_link_libraries(${autolinked_library} ${CPP_SHARED})
  endforeach()
endif()
